#!/usr/bin/env node

import fs from "node:fs";

const filename = process.argv[2];
if (!filename) {
  console.error("usage: node scripts/check-ts.mjs FILE.ts");
  process.exit(2);
}

const data = fs.readFileSync(filename);
const packetSize = 188;
if (data.length < packetSize || data[0] !== 0x47) {
  throw new Error("input is not an aligned 188-byte MPEG-TS");
}

const stats = new Map();
const assemblers = new Map();
const pmtPids = new Set();
const programs = new Map();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit++) {
      crc = ((crc << 1) ^ ((crc & 0x80000000) ? 0x04c11db7 : 0)) >>> 0;
    }
  }
  return crc >>> 0;
}

function payloadOf(packet, afc) {
  if ((afc & 1) === 0) return null;
  let offset = 4;
  if (afc & 2) offset += 1 + packet[4];
  return offset < packetSize ? packet.subarray(offset) : null;
}

function parsePat(section) {
  const length = ((section[1] & 0x0f) << 8) | section[2];
  for (let pos = 8; pos + 4 <= 3 + length - 4; pos += 4) {
    const program = section.readUInt16BE(pos);
    const pid = section.readUInt16BE(pos + 2) & 0x1fff;
    if (program !== 0) pmtPids.add(pid);
  }
}

function parsePmt(section) {
  const length = ((section[1] & 0x0f) << 8) | section[2];
  const program = section.readUInt16BE(3);
  const programInfoLength = ((section[10] & 3) << 8) | section[11];
  const streams = [];
  for (let pos = 12 + programInfoLength; pos + 5 <= 3 + length - 4;) {
    const esInfoLength = ((section[pos + 3] & 3) << 8) | section[pos + 4];
    streams.push({ type: section[pos], pid: section.readUInt16BE(pos + 1) & 0x1fff });
    pos += 5 + esInfoLength;
  }
  programs.set(program, streams);
}

function consumePsi(pid, payload, pusi) {
  const isPsiPid = pid === 0 || pmtPids.has(pid);
  if (!isPsiPid || !payload) return;

  let assembler = assemblers.get(pid);
  if (pusi) {
    const start = 1 + payload[0];
    if (start >= payload.length) return;
    assembler = { bytes: Buffer.from(payload.subarray(start)), length: null };
    assemblers.set(pid, assembler);
  } else if (assembler) {
    assembler.bytes = Buffer.concat([assembler.bytes, payload]);
  }
  if (!assembler) return;

  if (assembler.length === null && assembler.bytes.length >= 3) {
    assembler.length = 3 + (((assembler.bytes[1] & 0x0f) << 8) | assembler.bytes[2]);
  }
  if (assembler.length === null || assembler.bytes.length < assembler.length) return;

  const section = assembler.bytes.subarray(0, assembler.length);
  assemblers.delete(pid);
  if (crc32(section) !== 0) return;
  if (pid === 0 && section[0] === 0x00) parsePat(section);
  if (pmtPids.has(pid) && section[0] === 0x02) parsePmt(section);
}

for (let offset = 0; offset + packetSize <= data.length; offset += packetSize) {
  const packet = data.subarray(offset, offset + packetSize);
  if (packet[0] !== 0x47) throw new Error(`TS sync lost at byte ${offset}`);
  const pid = ((packet[1] & 0x1f) << 8) | packet[2];
  const pusi = (packet[1] & 0x40) !== 0;
  const afc = (packet[3] >> 4) & 3;
  const cc = packet[3] & 0x0f;
  const hasPayload = (afc & 1) !== 0;
  const stat = stats.get(pid) ?? { packets: 0, ccErrors: 0, expectedCc: null };
  stat.packets++;
  if (hasPayload) {
    if (stat.expectedCc !== null && cc !== stat.expectedCc) stat.ccErrors++;
    stat.expectedCc = (cc + 1) & 0x0f;
  }
  stats.set(pid, stat);
  consumePsi(pid, payloadOf(packet, afc), pusi);
}

const results = [];
let invalid = false;
for (const [program, streams] of programs) {
  const video = streams.find((stream) => stream.type === 0x1b);
  if (!video) continue;
  const stat = stats.get(video.pid) ?? { packets: 0, ccErrors: 0 };
  const reservedPid = video.pid === 0 || video.pid === 0x1fff;
  invalid ||= reservedPid || stat.ccErrors > 0 || stat.packets === 0;
  results.push({
    program,
    codec: "H.264/AVC",
    videoPid: `0x${video.pid.toString(16).padStart(4, "0")}`,
    packets: stat.packets,
    continuityErrors: stat.ccErrors,
    valid: !reservedPid && stat.ccErrors === 0 && stat.packets > 0,
  });
}

console.log(JSON.stringify({ file: filename, programs: results }, null, 2));
if (results.length === 0) {
  console.error("H.264 video was not found in a complete, CRC-valid PMT");
  process.exit(1);
}
if (invalid) {
  console.error("invalid H.264 TS: reserved/missing video PID or continuity errors detected");
  process.exit(1);
}
