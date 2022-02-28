// Copyright (C) 2020-2022 Russell Clarey. All rights reserved. MIT license.

import { withTimeout } from "./utils.ts";

const TIMEOUT = 2000;

const te = new TextEncoder();
const td = new TextDecoder();
const clientAddr = {
  hostname: "0.0.0.0",
  port: 0,
  transport: "udp",
} as const;
const serverAddr = {
  hostname: "239.255.255.250",
  port: 1900,
  transport: "udp",
} as const;
const serviceName = "urn:schemas-upnp-org:service:WANIPConnection:1";
const ctrlUrlPattern = new RegExp(
  `<serviceType>${serviceName}</serviceType>.*?<controlURL>(?<url>.*?)<\/controlURL>`,
  "s",
);
const search = te.encode(
  "M-SEARCH * HTTP/1.1\r\n" +
    "HOST:239.255.255.250:1900\r\n" +
    "ST:urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n" +
    "MX:2\r\n" +
    'MAN:"ssdp:discover"\r\n' +
    "\r\n",
);

function getGatewayControlUrl(): Promise<URL> {
  return withTimeout(async () => {
    const conn = Deno.listenDatagram(clientAddr);
    await conn.send(search, serverAddr);
    const [searchRes, addr] = await conn.receive();
    conn.close();

    const resStr = td.decode(searchRes);
    const locMatch = resStr.match(/location: (?<url>.*)/i);
    if (!locMatch?.groups?.url) {
      throw new Error(
        "UPnP: Failed to extract description URL from gateway response",
      );
    }

    const baseUrl = new URL(locMatch.groups.url);
    baseUrl.hostname = (addr as Deno.NetAddr).hostname;

    const desc = await (await fetch(baseUrl.toString())).text();
    const ctrlMatch = desc.match(ctrlUrlPattern);
    if (!ctrlMatch?.groups?.url) {
      throw new Error(
        "UPnp: Failed to extract control URL from gateway response",
      );
    }

    return new URL(ctrlMatch.groups.url, baseUrl);
  }, TIMEOUT);
}

function action(
  ctrlUrl: URL,
  name: string,
  args: Record<string, string | number>,
): Promise<Response> {
  return fetch(ctrlUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      SOAPAction: `"${serviceName}#${name}"`,
    },
    body: `<?xml version="1.0"?>
    <s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
      <s:Body>
        <u:${name} xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1">
          ${
      Object.entries(args)
        .map(([k, v]) => `<${k}>${v}</${k}>`)
        .join("\n")
    }
        </u:${name}>
      </s:Body>
    </s:Envelope>`,
  });
}

function getInternalIp(ctrlUrl: URL): Promise<string> {
  return withTimeout(async () => {
    console.log("connect:", ctrlUrl.hostname, ctrlUrl.port);
    const conn = await Deno.connect({
      hostname: ctrlUrl.hostname,
      port: Number(ctrlUrl.port),
    });
    const internalIp = (conn.localAddr as Deno.NetAddr).hostname;
    conn.close();
    return internalIp;
  }, TIMEOUT);
}

function getExternalIp(ctrlUrl: URL): Promise<string> {
  return withTimeout(async () => {
    const res = await action(ctrlUrl, "GetExternalIPAddress", {
      NewExternalIPAddress: "",
    });
    if (!res.ok) {
      // TODO: parse SOAP error message
      throw new Error(await res.text());
    }

    const match = (await res.text()).match(
      /<NewExternalIPAddress>(?<ip>.*?)<\/NewExternalIPAddress>/,
    );
    if (!match?.groups?.ip) {
      throw new Error(
        "UPnP: Failed to extract external IP address from gateway response",
      );
    }
    return match.groups.ip;
  }, TIMEOUT);
}

function addPortMapping(
  ctrlUrl: URL,
  internalIp: string,
  port: number,
): Promise<void> {
  return withTimeout(async () => {
    const res = await action(ctrlUrl, "AddPortMapping", {
      NewRemoteHost: "",
      NewExternalPort: port,
      NewProtocol: "TCP",
      NewInternalPort: port,
      NewInternalClient: internalIp,
      NewEnabled: "True",
      NewPortMappingDescription: "via upnp.ts",
      // 30min
      NewLeaseDuration: 60,
    });

    if (!res.ok) {
      // TODO: parse SOAP error message
      throw new Error(await res.text());
    }
  }, TIMEOUT);
}

export async function getIpAddrsAndMapPort(
  port: number,
): Promise<[string, string]> {
  const ctrlUrl = await getGatewayControlUrl();
  const internalIp = await getInternalIp(ctrlUrl);
  const [externalIp] = await Promise.all([
    getExternalIp(ctrlUrl),
    addPortMapping(ctrlUrl, internalIp, port),
  ]);

  return [internalIp, externalIp];
}
