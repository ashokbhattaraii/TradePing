#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

const ports = process.argv
  .slice(2)
  .map((value) => Number(value))
  .filter((value) => Number.isInteger(value) && value > 0);

if (ports.length === 0) {
  console.log('No ports provided.');
  process.exit(0);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function findPids(port) {
  if (process.platform === 'win32') {
    const output = execFileSync('cmd.exe', ['/d', '/s', '/c', `netstat -ano -p tcp | findstr ":${port}"`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    return output
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .filter((parts) => parts[1]?.endsWith(`:${port}`) && parts[3] === 'LISTENING')
      .map((parts) => Number(parts[4]))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  }

  const output = execFileSync('lsof', ['-nP', `-tiTCP:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  return output
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function listProcesses() {
  const output = execFileSync('ps', ['ax', '-o', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  const processes = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    const [, pid, ppid, command] = match;
    processes.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), command });
  }

  return processes;
}

function isLocalDevProcess(command) {
  return (
    command.includes(repoRoot) ||
    command.includes('nest start --watch') ||
    command.includes('next dev') ||
    command.includes('next-server')
  );
}

function expandLocalProcessTree(pids) {
  if (process.platform === 'win32') return pids;

  const processes = listProcesses();
  const selected = new Set(pids);

  for (const pid of pids) {
    let current = processes.get(pid);
    while (current) {
      if (!isLocalDevProcess(current.command)) break;
      selected.add(current.pid);
      current = processes.get(current.ppid);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const processInfo of processes.values()) {
      if (selected.has(processInfo.ppid) && isLocalDevProcess(processInfo.command) && !selected.has(processInfo.pid)) {
        selected.add(processInfo.pid);
        changed = true;
      }
    }
  }

  return Array.from(selected);
}

for (const port of ports) {
  let pids = [];
  try {
    pids = expandLocalProcessTree(Array.from(new Set(findPids(port))));
  } catch {
    console.log(`port ${port}: free`);
    continue;
  }

  if (pids.length === 0) {
    console.log(`port ${port}: free`);
    continue;
  }

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`port ${port}: stopped pid ${pid}`);
    } catch (error) {
      console.warn(`port ${port}: could not stop pid ${pid} (${error.message})`);
    }
  }

  for (let attempt = 0; attempt < 10; attempt++) {
    sleep(100);
    try {
      pids = Array.from(new Set(findPids(port)));
    } catch {
      pids = [];
    }
    if (pids.length === 0) break;
  }

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
      console.log(`port ${port}: force-stopped pid ${pid}`);
    } catch (error) {
      console.warn(`port ${port}: could not force-stop pid ${pid} (${error.message})`);
    }
  }
}
