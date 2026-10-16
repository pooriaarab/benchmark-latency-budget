// Seeded generator for benchmark-latency-budget tasks.
// Usage: node scripts/gen-tasks.mjs [--seed N] [--split public|hidden]
//   public (default): writes data/tasks.jsonl with seed 20261015 unless --seed is given.
//   hidden: writes artifacts/tasks.hidden.jsonl (gitignored, never published).
//   The hidden split derives from a transformed seed, so the same --seed
//   still produces prompts and answers that differ from the public set.
import { mkdir, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const seedArg = args.indexOf("--seed");
const splitArg = args.indexOf("--split");
const split = splitArg === -1 ? "public" : args[splitArg + 1];
if (split !== "public" && split !== "hidden") throw new Error(`Unknown split: ${split}.`);
const seed = seedArg === -1 ? 20261015 : Number(args[seedArg + 1]);
if (!Number.isInteger(seed)) throw new Error("Seed must be an integer.");

const HIDDEN_SEED_OFFSET = 0x9e3779b9;
const THINK_MS = 80;
const DEADLINE_MIN_FACTOR = 1.5;
const DEADLINE_SPREAD = 0.5;

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
function choose(rand, variants) {
  return variants[Math.floor(rand() * variants.length)];
}
function latency(rand, cls, tool) {
  const [lo, hi] = RANGES[cls][tool];
  return lo + Math.floor(rand() * (hi - lo + 1));
}

function directory(rand, people) {
  const dir = {};
  const usedExtensions = new Set();
  for (const name of people) {
    let extension = String(1000 + Math.floor(rand() * 9000));
    while (usedExtensions.has(extension)) extension = String(1000 + Math.floor(rand() * 9000));
    usedExtensions.add(extension);
    dir[name] = { extension, room: ROOMS[Math.floor(rand() * ROOMS.length)] };
  }
  return dir;
}

function extensionCandidates(dir) {
  return Object.values(dir).map((entry) => entry.extension);
}

function buildVoice(rand, index) {
  const kind = index % 3;
  const cls = "voice";
  const people = pick(rand, NAMES, 4);
  const dir = directory(rand, people);
  const latencyMs = { lookup: latency(rand, cls, "lookup"), calendar_get: latency(rand, cls, "calendar_get"), search_docs: latency(rand, cls, "search_docs") };
  if (kind === 0) {
    const name = people[0];
    const prompt = choose(rand, [
      `What is the phone extension for ${name}?`,
      `Phone extension for ${name}?`,
      `What extension does ${name} have?`,
      `Give me ${name}'s phone extension.`,
    ]);
    return base(cls, `voice-${pad(index + 1)}`, prompt, dir[name].extension,
      latencyMs, { directory: dir }, [{ name: "lookup", args: { key: name } }], extensionCandidates(dir), rand);
  }
  if (kind === 1) {
    const date = choose(rand, DATES);
    const [eventA, eventB] = pick(rand, EVENTS, 2);
    const [roomA, roomB] = pick(rand, ROOMS, 2);
    const calendar = { [date]: [{ event: eventA, room: roomA, organizer: people[0] }, { event: eventB, room: roomB, organizer: people[1] }] };
    const prompt = choose(rand, [
      `Which room is ${eventA} on ${date}?`,
      `What room hosts ${eventA} on ${date}?`,
      `Where does ${eventA} take place on ${date}?`,
    ]);
    return base(cls, `voice-${pad(index + 1)}`, prompt, roomA,
      latencyMs, { directory: dir, calendar }, [{ name: "calendar_get", args: { date } }], [roomA, roomB], rand);
  }
  const [topic, title] = choose(rand, DOCS);
  const others = pick(rand, DOCS.filter((d) => d[1] !== title), 2);
  const docs = [{ title, topic, author: people[0] }, ...others.map(([t, t2]) => ({ title: t2, topic: t, author: people[1] }))];
  const prompt = choose(rand, [
    `Which internal doc explains ${topic}?`,
    `What internal doc covers ${topic}?`,
    `Name the internal doc about ${topic}.`,
  ]);
  return base(cls, `voice-${pad(index + 1)}`, prompt, title,
    latencyMs, { directory: dir, docs }, [{ name: "search_docs", args: { query: topic } }], docs.map((doc) => doc.title), rand);
}

function buildUi(rand, index) {
  const cls = "ui";
  const first = index % 2 === 0;
  const people = pick(rand, NAMES, 5);
  const dir = directory(rand, people);
  const latencyMs = { lookup: latency(rand, cls, "lookup"), calendar_get: latency(rand, cls, "calendar_get"), search_docs: latency(rand, cls, "search_docs") };
  if (first) {
    const date = choose(rand, DATES);
    const event = choose(rand, EVENTS);
    const organizer = people[0];
    const calendar = { [date]: [{ event, room: choose(rand, ROOMS), organizer }, { event: choose(rand, EVENTS), room: choose(rand, ROOMS), organizer: people[1] }] };
    const prompt = choose(rand, [
      `What is the phone extension of the organizer of ${event} on ${date}?`,
      `Who organizes ${event} on ${date}, and what is their extension?`,
      `Extension of the organizer for ${event} on ${date}?`,
    ]);
    return base(cls, `ui-${pad(index + 1)}`, prompt, dir[organizer].extension,
      latencyMs, { directory: dir, calendar },
      [{ name: "calendar_get", args: { date } }, { name: "lookup", args: { key: organizer } }], extensionCandidates(dir), rand);
  }
  const [topic, title] = choose(rand, DOCS);
  const author = people[0];
  const others = pick(rand, DOCS.filter((d) => d[1] !== title), 3);
  const docs = [{ title, topic, author }, ...others.map(([t, t2], i) => ({ title: t2, topic: t, author: people[i + 1] }))];
  const prompt = choose(rand, [
    `What is the phone extension of the author of the doc about ${topic}?`,
    `What extension does the author of the doc on ${topic} have?`,
    `Who wrote the doc about ${topic}, and what is their extension?`,
  ]);
  return base(cls, `ui-${pad(index + 1)}`, prompt, dir[author].extension,
    latencyMs, { directory: dir, docs },
    [{ name: "search_docs", args: { query: topic } }, { name: "lookup", args: { key: author } }], extensionCandidates(dir), rand);
}

function buildBackground(rand, index) {
  const cls = "background";
  const first = index % 2 === 0;
  const people = pick(rand, NAMES, 6);
  const dir = directory(rand, people);
  const latencyMs = { lookup: latency(rand, cls, "lookup"), calendar_get: latency(rand, cls, "calendar_get"), search_docs: latency(rand, cls, "search_docs") };
  if (first) {
    const date = choose(rand, DATES);
    const event = choose(rand, EVENTS);
    const [topic, title] = choose(rand, DOCS);
    const author = people[0];
    const calendar = { [date]: [{ event, room: choose(rand, ROOMS), organizer: people[1], topic }] };
    const others = pick(rand, DOCS.filter((d) => d[1] !== title), 4);
    const docs = [{ title, topic, author }, ...others.map(([t, t2], i) => ({ title: t2, topic: t, author: people[i + 1] }))];
    const prompt = choose(rand, [
      `What is the phone extension of the author of the internal doc covering the topic of ${event} on ${date}?`,
      `The internal doc on ${event} for ${date} has an author. What is their extension?`,
      `Find the internal doc covering ${event} on ${date}; what extension does its author have?`,
    ]);
    return base(cls, `bg-${pad(index + 1)}`, prompt, dir[author].extension,
      latencyMs, { directory: dir, calendar, docs },
      [{ name: "calendar_get", args: { date } }, { name: "search_docs", args: { query: topic } }, { name: "lookup", args: { key: author } }], extensionCandidates(dir), rand);
  }
  const [topic, title] = choose(rand, DOCS);
  const date = choose(rand, DATES);
  const event = choose(rand, EVENTS);
  const organizer = people[0];
  const calendar = { [date]: [{ event, room: choose(rand, ROOMS), organizer }] };
  const others = pick(rand, DOCS.filter((d) => d[1] !== title), 4);
  const docs = [{ title, topic, author: people[1], event, date }, ...others.map(([t, t2], i) => ({ title: t2, topic: t, author: people[i + 2] }))];
  const prompt = choose(rand, [
    `A doc about ${topic} mentions an event. What is the phone extension of that event's organizer?`,
    `The doc on ${topic} names an event. What extension does its organizer have?`,
    `Read the doc about ${topic} and give me the extension of the organizer of the event it mentions.`,
  ]);
  return base(cls, `bg-${pad(index + 1)}`, prompt, dir[organizer].extension,
    latencyMs, { directory: dir, calendar, docs },
    [{ name: "search_docs", args: { query: topic } }, { name: "calendar_get", args: { date } }, { name: "lookup", args: { key: organizer } }], extensionCandidates(dir), rand);
}

function base(cls, id, prompt, expected, latencyMs, fixtures, minimalCalls, candidates, rand) {
  const thinkMs = THINK_MS;
  // Shortest path: one declared turn per minimal call plus the final answer
  // turn, plus the scheduled charge of every minimal call.
  const shortest = thinkMs * (minimalCalls.length + 1) + minimalCalls.reduce((sum, call) => sum + latencyMs[call.name], 0);
  const deadlineMs = Math.round(shortest * (DEADLINE_MIN_FACTOR + rand() * DEADLINE_SPREAD));
  if (prompt.toLowerCase().includes(String(expected).toLowerCase())) throw new Error(`Task ${id} prompt leaks the answer.`);
  const uniqueCandidates = [...new Set(candidates)];
  if (!uniqueCandidates.some((value) => value.toLowerCase() === String(expected).toLowerCase())) {
    throw new Error(`Task ${id} expected value is not in its candidate list.`);
  }
  return {
    id, kind: "episode", prompt, expected,
    metadata: { budgetClass: cls, deadlineMs, thinkMs, latencyMs, fixtures, minimalCalls, candidates: uniqueCandidates, seed: seed + shortest },
  };
}

function pad(n) { return String(n).padStart(2, "0"); }

const rand = mulberry32(split === "hidden" ? seed + HIDDEN_SEED_OFFSET : seed);
const tasks = [
  ...Array.from({ length: 12 }, (_, i) => buildVoice(rand, i)),
  ...Array.from({ length: 12 }, (_, i) => buildUi(rand, i)),
  ...Array.from({ length: 12 }, (_, i) => buildBackground(rand, i)),
];
// Hidden ids carry an h- prefix so a hidden run's report rows can never be
// mistaken for public ones (or silently matched against the public set).
if (split === "hidden") for (const t of tasks) t.id = `h-${t.id}`;
const ids = new Set(tasks.map((t) => t.id));
if (ids.size !== 36) throw new Error("Task ids are not unique.");
for (const t of tasks) {
  if (!t.expected || String(t.expected).trim() === "") throw new Error(`Task ${t.id} has an empty answer.`);
}

const out = split === "hidden" ? "artifacts/tasks.hidden.jsonl" : "data/tasks.jsonl";
await mkdir(split === "hidden" ? "artifacts" : "data", { recursive: true });
await writeFile(out, `${tasks.map((t) => JSON.stringify(t)).join("\n")}\n`);
console.log(`generated ${tasks.length} ${split} tasks with seed ${seed} -> ${out}`);
