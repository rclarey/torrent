// Copyright (C) 2020-2021 Russell Clarey. All rights reserved. MIT license.

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

function getGatewayControlUrl(): Promise<string | null> {
  return withTimeout(async () => {
    const conn = Deno.listenDatagram(clientAddr);
    await conn.send(search, serverAddr);
    const [searchRes, addr] = await conn.receive();
    conn.close();

    const resStr = td.decode(searchRes);
    const locMatch = resStr.match(/location: (?<url>.*)/i);
    if (!locMatch?.groups?.url) {
      console.error("Failed to extract description URL from gateway response");
      return null;
    }

    const baseUrl = new URL(locMatch.groups.url);
    baseUrl.hostname = (addr as Deno.NetAddr).hostname;

    const desc = await (await fetch(baseUrl.toString())).text();
    const ctrlMatch = desc.match(ctrlUrlPattern);
    if (!ctrlMatch?.groups?.url) {
      console.error("Failed to extract control URL from gateway response");
      return null;
    }

    return new URL(ctrlMatch.groups.url, baseUrl).toString();
  }, TIMEOUT);
}

function action(
  ctrlUrl: string,
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

function getExternalIp(ctrlUrl: string): Promise<string | null> {
  return withTimeout(async () => {
    const res = await action(ctrlUrl, "GetExternalIPAddress", {
      NewExternalIPAddress: "",
    });
    if (!res.ok) {
      return null;
    }

    const match = (await res.text()).match(
      /<NewExternalIPAddress>(?<ip>.*?)<\/NewExternalIPAddress>/,
    );
    if (!match?.groups?.ip) {
      console.error(
        "Failed to extract external IP address from gateway response",
      );
      return null;
    }
    return match.groups.ip;
  }, TIMEOUT);
}

function addPortMapping(
  ctrlUrl: string,
  internalIp: string,
  port: number,
): Promise<boolean> {
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
      console.error(await res.text());
      return false;
    }

    return true;
  }, TIMEOUT);
}

export async function getExternalIpAndMapPort(
  internalIp: string,
  port: number,
): Promise<string | null> {
  try {
    const ctrlUrl = await getGatewayControlUrl();
    if (!ctrlUrl) {
      return null;
    }

    const externalIp = await getExternalIp(ctrlUrl);
    const addedMapping = await addPortMapping(ctrlUrl, internalIp, port);

    return externalIp && addedMapping ? externalIp : null;
  } catch (e) {
    console.log(e);
    return null;
  }
}
