// Copyright (C) 2020-2022 Russell Clarey. All rights reserved. MIT license.

import { InfoDict } from "./metainfo.ts";
import { PieceMsg, RequestMsg } from "./protocol.ts";

export const BLOCK_SIZE = 1024 * 16;

function stringify(msg: RequestMsg | PieceMsg) {
  return JSON.stringify(
    "block" in msg
      ? { ...msg, block: `[Uint8Array; ${msg.block.length}]` }
      : msg,
  );
}

function pieceLength(n: number, info: InfoDict) {
  return (n === info.pieces.length - 1 && info.length % info.pieceLength) ||
    info.pieceLength;
}

export function validateRequestedBlock(info: InfoDict, msg: RequestMsg) {
  if (msg.index >= info.pieces.length) {
    throw new Error(
      `request message with invalid piece index ${stringify(msg)}`,
    );
  }
  const reqEnd = msg.offset + msg.length;
  const lastPieceLength = pieceLength(info.pieces.length - 1, info);
  if (
    (msg.index === info.pieces.length - 1 && reqEnd > lastPieceLength) ||
    reqEnd > info.pieceLength
  ) {
    throw new Error(
      `request message with invalid block length ${stringify(msg)}`,
    );
  }
}

export function validateReceivedBlock(info: InfoDict, msg: PieceMsg) {
  if (msg.index >= info.pieces.length) {
    throw new Error(`piece message with invalid piece index ${stringify(msg)}`);
  }
  if (msg.offset % BLOCK_SIZE !== 0) {
    throw new Error(
      `piece message with invalid block offset ${stringify(msg)}`,
    );
  }

  const pieceLen = pieceLength(msg.index, info);
  const numBlocks = Math.ceil(pieceLen / BLOCK_SIZE);
  const nBlock = Math.floor(msg.offset / BLOCK_SIZE);

  if (msg.index === info.pieces.length - 1 && nBlock === numBlocks - 1) {
    const lastBlockLength = pieceLen % BLOCK_SIZE || BLOCK_SIZE;
    if (msg.block.length !== lastBlockLength) {
      throw new Error(
        `piece message with invalid last block length ${stringify(msg)}`,
      );
    }
  } else if (msg.block.length !== BLOCK_SIZE) {
    throw new Error(
      `piece message with invalid block length ${stringify(msg)}`,
    );
  }
}
