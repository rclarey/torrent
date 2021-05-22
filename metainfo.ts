// Copyright (C) 2020-2021 Russell Clarey. All rights reserved. MIT license.

import { bdecode } from "./bencode.ts";
import { arr, inst, num, obj, or, undef } from "./valid.ts";
import { partition } from "./_bytes.ts";

const enum PrivateValue {
  public = 0,
  private = 1,
}

interface CommonInfoDict {
  /** number of bytes in each piece */
  pieceLength: number;
  /** 20-byte SHA1 hash values of each piece */
  pieces: Uint8Array[];
  /** flag to indicate this is a private torrent */
  private: PrivateValue;
}

export interface SingleFileInfoDict extends CommonInfoDict {
  /** the filename */
  name: string;
  /** length of the file in bytes */
  length: number;
}

export interface MultiFileFields {
  /** length of the file in bytes */
  length: number;
  /** array representing the path and filename */
  path: string[];
}

export interface MultiFileInfoDict extends CommonInfoDict {
  /** the name of the directory in which to store all the files */
  name: string;
  /** length and path information for each of the files */
  files: MultiFileFields[];
}

export type InfoDict = SingleFileInfoDict | MultiFileInfoDict;

export interface MetaInfo {
  info: InfoDict;
  /** the announce URL of the tracker */
  announce: string;
  /** the creation time of the torrent, in standard UNIX epoch format */
  creationDate?: number;
  /* comments from the author */
  comment?: string;
  /** name and version of the program used to create the .torrent */
  createdBy?: string;
  /* the string encoding format used to generate the pieces part of the info dictionary */
  encoding?: string;
}

const validateSingleFileInfo = obj({
  "piece length": num,
  pieces: inst(Uint8Array),
  private: or(undef, num),
  name: inst(Uint8Array),
  length: num,
});

const validateMultiFileInfo = obj({
  "piece length": num,
  pieces: inst(Uint8Array),
  private: or(undef, num),
  name: inst(Uint8Array),
  files: arr(
    obj({
      length: num,
      path: arr(inst(Uint8Array)),
    }),
  ),
});

const validateMetaInfo = obj({
  info: or(validateSingleFileInfo, validateMultiFileInfo),
  announce: inst(Uint8Array),
  "creation date": or(undef, num),
  comment: or(undef, inst(Uint8Array)),
  "created by": or(undef, inst(Uint8Array)),
  encoding: or(undef, inst(Uint8Array)),
});

const td = new TextDecoder();
function decodeIfDef(str?: Uint8Array): string | undefined {
  return str !== undefined ? td.decode(str) : str;
}

/**
 * parse and validate a bencoded metainfo file, returning null if it is invalid
 */
export function parseMetaInfo(bytes: Uint8Array): MetaInfo | null {
  try {
    const meta = bdecode(bytes);
    if (!validateMetaInfo(meta)) {
      return null;
    }

    const common = {
      announce: td.decode(meta.announce),
      creationDate: meta["creation date"],
      comment: decodeIfDef(meta.comment),
      createdBy: decodeIfDef(meta["created by"]),
      encoding: decodeIfDef(meta.encoding),
    };
    const commonInfo = {
      pieceLength: meta.info["piece length"],
      pieces: partition(meta.info.pieces, 20),
      private: meta.info.private === 1 ? 1 : 0,
      name: td.decode(meta.info.name),
    };

    if ("files" in meta.info) {
      return {
        ...common,
        info: {
          ...commonInfo,
          files: meta.info.files.map((file) => ({
            length: file.length,
            path: file.path.map((x) => td.decode(x)),
          })),
        },
      };
    }

    return { ...common, info: { ...commonInfo, length: meta.info.length } };
  } catch {
    return null;
  }
}
