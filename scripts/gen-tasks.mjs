// Seeded generator for benchmark-latency-budget tasks.
// Usage: node scripts/gen-tasks.mjs [--seed N] [--split public|hidden]
//   public (default): writes data/tasks.jsonl with seed 20261015 unless --seed is given.
//   hidden: writes artifacts/tasks.hidden.jsonl (gitignored, never published).
import { mkdir, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const seedArg = args.indexOf("--seed");
const splitArg = args.indexOf("--split");
const split = splitArg === -1 ? "public" : args[splitArg + 1];
if (split !== "public" && split !== "hidden") throw new Error(`Unknown split: ${split}.`);
const seed = seedArg === -1 ? 20261015 : Number(args[seedArg + 1]);
if (!Number.isInteger(seed)) throw new Error("Seed must be an integer.");

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ["Amara Okafor", "Jonas Lindqvist", "Priya Nair", "Tomas Ribeiro", "Grace Mwangi", "Kenji Sato", "Lina Haddad", "Omar Farouk", "Sofia Marchetti", "David Kim", "Ana Petrova", "Ravi Menon", "Ella Novak", "Marco Silva", "Yuki Tanaka", "Fatima Diallo"];
const ROOMS = ["3B", "North-2", "Atrium-1", "2C", "Focus-4", "Garden-A", "1D", "West-3"];
const DATES = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"];
const EVENTS = ["Sprint review", "Design crit", "Roadmap sync", "Support handoff", "Demo Friday", "Retro", "Onboarding", "Release train"];
const DOCS = [
  ["expense policy", "Expensing travel the simple way"],
  ["vpn setup", "Connect to the office VPN"],
  ["parental leave", "Parental leave, step by step"],
  ["incident response", "Who to page when prod is down"],
  ["data retention", "Keeping customer data for 30 days"],
  ["refund window", "Refunds within 14 days"],
  ["editor shortcuts", "Ten shortcuts for the editor"],
  ["seating plan", "Where each team sits"],
];

const BUDGETS = { voice: 700, ui: 2000, background: 10000 };
const RANGES = {
  voice: { lookup: [100, 220], calendar_get: [100, 220], search_docs: [100, 220] },
  ui: { lookup: [120, 300], calendar_get: [150, 350], search_docs: [180, 420] },
  background: { lookup: [250, 700], calendar_get: [250, 700], search_docs: [250, 700] },
};

function pick(rand, list, count) {
  const pool = [...list]; const out = [];
  while (out.length < count && pool.length > 0) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}
function latency(rand, cls, tool) {
  const [lo, hi] = RANGES[cls][tool];
  return lo + Math.floor(rand() * (hi - lo + 1));
}

function directory(rand, people) {
  const dir = {};
  for (const name of people) {
    dir[name] = {
      extension: String(1000 + Math.floor(rand() * 9000)),
      room: ROOMS[Math.floor(rand() * ROOMS.length)],
    };
  }
  return dir;
}

function buildVoice(rand, index) {
  const kind = index % 3;
  const cls = "voice";
  const people = pick(rand, NAMES, 4);
  const dir = directory(rand, people);
  const latencyMs = { lookup: latency(rand, cls, "lookup"), calendar_get: latency(rand, cls, "calendar_get"), search_docs: latency(rand, cls, "search_docs") };
  if (kind === 0) {
    const name = people[0];
    return base(cls, `voice-${pad(index + 1)}`, `What is the phone extension for ${name}?`, dir[name].extension,
      latencyMs, { directory: dir }, [{ name: "lookup", args: { key: name } }], rand);
  }
  if (kind === 1) {
    const date = DATES[index % DATES.length];
    const [eventA, eventB] = pick(rand, EVENTS, 2);
    const orgA = people[0]; const orgB = people[1];
    const roomA = ROOMS[Math.floor(rand() * ROOMS.length)];
    const roomB = ROOMS[Math.floor(rand() * ROOMS.length)];
    const calendar = { [date]: [{ event: eventA, room: roomA, organizer: orgA }, { event: eventB, room: roomB, organizer: orgB }] };
    return base(cls, `voice-${pad(index + 1)}`, `Which room is ${eventA} on ${date}?`, roomA,
      latencyMs, { directory: dir, calendar }, [{ name: "calendar_get", args: { date } }], rand);
  }
  const [topic, title] = DOCS[index % DOCS.length];
  const others = pick(rand, DOCS.filter((d) => d[1] !== title), 2);
  const docs = [{ title, topic, author: people[0] }, ...others.map(([t, t2]) => ({ title: t2, topic: t, author: people[1] }))];
  return base(cls, `voice-${pad(index + 1)}`, `Which internal doc explains ${topic}?`, title,
    latencyMs, { directory: dir, docs }, [{ name: "search_docs", args: { query: topic } }], rand);
}

function buildUi(rand, index) {
  const cls = "ui";
  const first = index % 2 === 0;
  const people = pick(rand, NAMES, 5);
  const dir = directory(rand, people);
  const latencyMs = { lookup: latency(rand, cls, "lookup"), calendar_get: latency(rand, cls, "calendar_get"), search_docs: latency(rand, cls, "search_docs") };
  if (first) {
    const date = DATES[index % DATES.length];
    const event = EVENTS[index % EVENTS.length];
    const organizer = people[0];
    const room = ROOMS[Math.floor(rand() * ROOMS.length)];
    const calendar = { [date]: [{ event, room, organizer }, { event: EVENTS[(index + 3) % EVENTS.length], room: ROOMS[(index + 1) % ROOMS.length], organizer: people[1] }] };
    return base(cls, `ui-${pad(index + 1)}`, `What is the phone extension of the organizer of ${event} on ${date}?`, dir[organizer].extension,
      latencyMs, { directory: dir, calendar },
      [{ name: "calendar_get", args: { date } }, { name: "lookup", args: { key: organizer } }], rand);
  }
  const [topic, title] = DOCS[index % DOCS.length];
  const author = people[0];
  const others = pick(rand, DOCS.filter((d) => d[1] !== title), 3);
  const docs = [{ title, topic, author }, ...others.map(([t, t2], i) => ({ title: t2, topic: t, author: people[i + 1] }))];
  return base(cls, `ui-${pad(index + 1)}`, `What is the phone extension of the author of the doc about ${topic}?`, dir[author].extension,
    latencyMs, { directory: dir, docs },
    [{ name: "search_docs", args: { query: topic } }, { name: "lookup", args: { key: author } }], rand);
}

function buildBackground(rand, index) {
  const cls = "background";
  const first = index % 2 === 0;
  const people = pick(rand, NAMES, 6);
  const dir = directory(rand, people);
  const latencyMs = { lookup: latency(rand, cls, "lookup"), calendar_get: latency(rand, cls, "calendar_get"), search_docs: latency(rand, cls, "search_docs") };
  if (first) {
    const date = DATES[index % DATES.length];
    const event = EVENTS[index % EVENTS.length];
    const [topic, title] = DOCS[index % DOCS.length];
    const author = people[0];
    const calendar = { [date]: [{ event, room: ROOMS[index % ROOMS.length], organizer: people[1], topic }] };
    const others = pick(rand, DOCS.filter((d) => d[1] !== title), 4);
    const docs = [{ title, topic, author }, ...others.map(([t, t2], i) => ({ title: t2, topic: t, author: people[i + 1] }))];
    return base(cls, `bg-${pad(index + 1)}`, `What is the phone extension of the author of the internal doc covering the topic of ${event} on ${date}?`, dir[author].extension,
      latencyMs, { directory: dir, calendar, docs },
      [{ name: "calendar_get", args: { date } }, { name: "search_docs", args: { query: topic } }, { name: "lookup", args: { key: author } }], rand);
  }
  const [topic, title] = DOCS[(index + 2) % DOCS.length];
  const date = DATES[(index + 1) % DATES.length];
  const event = EVENTS[(index + 2) % EVENTS.length];
  const organizer = people[0];
  const calendar = { [date]: [{ event, room: ROOMS[(index + 2) % ROOMS.length], organizer }] };
  const others = pick(rand, DOCS.filter((d) => d[1] !== title), 4);
  const docs = [{ title, topic, author: people[1], event, date }, ...others.map(([t, t2], i) => ({ title: t2, topic: t, author: people[i + 2] }))];
  return base(cls, `bg-${pad(index + 1)}`, `A doc about ${topic} mentions an event. What is the phone extension of that event's organizer?`, dir[organizer].extension,
    latencyMs, { directory: dir, calendar, docs },
    [{ name: "search_docs", args: { query: topic } }, { name: "calendar_get", args: { date } }, { name: "lookup", args: { key: organizer } }], rand);
}

function base(cls, id, prompt, expected, latencyMs, fixtures, minimalCalls, rand) {
  const thinkMs = 80;
  const total = thinkMs + minimalCalls.reduce((sum, call) => sum + latencyMs[call.name], 0);
  const deadlineMs = BUDGETS[cls];
  if (total > 0.8 * deadlineMs) throw new Error(`Task ${id} minimal path ${total}ms exceeds 80% of the ${deadlineMs}ms budget.`);
  if (prompt.toLowerCase().includes(String(expected).toLowerCase())) throw new Error(`Task ${id} prompt leaks the answer.`);
  return {
    id, kind: "episode", prompt, expected,
    metadata: { budgetClass: cls, deadlineMs, thinkMs, latencyMs, fixtures, minimalCalls, seed: seed + total },
  };
}

function pad(n) { return String(n).padStart(2, "0"); }

const rand = mulberry32(seed);
const tasks = [
  ...Array.from({ length: 12 }, (_, i) => buildVoice(rand, i)),
  ...Array.from({ length: 12 }, (_, i) => buildUi(rand, i)),
  ...Array.from({ length: 12 }, (_, i) => buildBackground(rand, i)),
];
const ids = new Set(tasks.map((t) => t.id));
if (ids.size !== 36) throw new Error("Task ids are not unique.");
for (const t of tasks) {
  if (!t.expected || String(t.expected).trim() === "") throw new Error(`Task ${t.id} has an empty answer.`);
}

const out = split === "hidden" ? "artifacts/tasks.hidden.jsonl" : "data/tasks.jsonl";
await mkdir(split === "hidden" ? "artifacts" : "data", { recursive: true });
await writeFile(out, `${tasks.map((t) => JSON.stringify(t)).join("\n")}\n`);
console.log(`generated ${tasks.length} ${split} tasks with seed ${seed} -> ${out}`);
