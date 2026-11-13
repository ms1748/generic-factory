// Makes the dashboard's sign-in secrets (auth.ts), printed for .env:
//
//   node src/hash-password.ts          asks for a password (twice, not shown) and prints FACTORY_PASSWORD_HASH=...
//   echo -n pw | node src/hash-password.ts   the same, reading the password from stdin
//   node src/hash-password.ts --token  prints a random FACTORY_DASHBOARD_TOKEN=...
//
// In Docker: `docker compose run --rm dispatcher node src/hash-password.ts`.
import { randomBytes } from "node:crypto";
import { hashPassword } from "./auth.ts";

const MIN = 12;

if (process.argv.includes("--token")) {
  console.log(`FACTORY_DASHBOARD_TOKEN=${randomBytes(32).toString("base64url")}`);
} else {
  const tty = process.stdin.isTTY;
  const pw = tty ? await ask("Password: ") : (await readAll()).replace(/\r?\n$/, "");
  if (tty && (await ask("Again: ")) !== pw) fail("The two didn't match.");
  if (pw.length < MIN) fail(`Use at least ${MIN} characters (or --token for a random token).`);
  console.log(`FACTORY_PASSWORD_HASH=${await hashPassword(pw)}`);
}

function fail(why: string): never {
  console.error(why);
  process.exit(1);
}

async function readAll(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Reads a line from the terminal without echoing it. */
function ask(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let out = "";
    const onData = (s: string) => {
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stderr.write("\n");
          return resolve(out);
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stderr.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") out = out.slice(0, -1);
        else if (ch >= " ") out += ch;
      }
    };
    stdin.on("data", onData);
  });
}
