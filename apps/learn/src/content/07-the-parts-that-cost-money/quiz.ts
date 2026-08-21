import type { Question } from "@/lib/quiz/types";

export const QUESTIONS: readonly Question[] = [
  {
    correct: 1,
    explanation:
      "Ten thousand domains with six requirements each, checked six times a day, is 360,000 rows a day — eleven million a month, almost all identical to the row before. The storage, index maintenance, backups and vacuum pressure turn a $20 bill into a $400 one, for rows nobody reads.",
    id: "unit7:row-count",
    options: [
      "About 60,000",
      "About 360,000",
      "About 3.6 million",
      "About 10,000",
    ],
    prompt:
      "Ten thousand domains, six requirements each, checked six times a day. How many rows a day does logging every check result produce?",
    source: "docs/DESIGN.md",
  },
  {
    correct: 3,
    explanation:
      "A requirement is satisfied by a property of the zone, and several record texts satisfy it identically. Comparing texts would append a timeline entry every time a customer reordered the mechanisms in their SPF record. The stored observation is the verdict plus the sorted diagnosis codes — the same signature consensus uses.",
    id: "unit7:observation-shape",
    options: [
      "The raw record text, so the timeline shows exactly what changed",
      "A hash of the whole zone",
      "The record's TTL and value together",
      "The verdict plus the sorted diagnosis codes",
    ],
    prompt:
      "What is compared to decide whether a requirement's observation changed?",
    source: "apps/api/src/domains/state.ts",
  },
  {
    correct: 0,
    explanation:
      "Most monitored domains sit in verified for weeks, so under a uniform sweep they are the overwhelming majority of queries and nearly all of the waste. Moving them to daily collapses the bill while domains that need attention get checked more often than a uniform interval would allow.",
    id: "unit7:adaptive-why",
    options: [
      "Most domains are verified and stable, so they dominate a uniform sweep's cost while needing the fewest checks",
      "Because DNS providers rate-limit frequent queries",
      "Because Postgres cannot sustain a five-minute sweep",
      "Because verified domains have longer TTLs than pending ones",
    ],
    prompt:
      "Why does adaptive scheduling cost roughly ten times less than a uniform sweep?",
    source: "apps/api/src/sweep/schedule.ts",
  },
  {
    correct: 2,
    explanation:
      "A zone's SOA serial increments when the zone changes, so checking it first tells you whether the six record queries are needed at all. One query instead of six is a four to six times reduction — but not every provider bumps the serial reliably, so a full verify still runs daily regardless.",
    id: "unit7:soa-serial",
    options: [
      "It is more accurate than checking individual records",
      "It avoids negative caching",
      "One query replaces six when the zone has not changed, and a daily full verify covers providers that do not bump it",
      "It works without EDNS0",
    ],
    prompt: "What does the SOA serial fast path buy, and what is its caveat?",
    source: "docs/DESIGN.md",
  },
  {
    correct: 1,
    explanation:
      "The rule bans paying per tick, not queues. A queue against a Redis container in the same compose stack is exactly the long-running process the rule asks for; a hosted Redis with per-command pricing against a sweeper waking every sixty seconds is the failure mode it exists to prevent.",
    id: "unit7:queues-allowed",
    options: [
      "No queue at all; the sweeper checks domains inline",
      "A queue is fine — the rule bans per-invocation billing, not queues",
      "Only an in-memory queue inside the sweeper process",
      "A queue, but only for webhook delivery",
    ],
    prompt:
      "The rule is 'no per-invocation billing in the sweep path'. What does that permit?",
    source: ".claude/CLAUDE.md",
  },
  {
    correct: 3,
    explanation:
      "next_check_at decides what is due and webhook_deliveries records what is owed, both in Postgres. So a flushed Redis costs in-flight attempts and never obligations — the next tick re-derives the due list from the same column.",
    id: "unit7:redis-flush",
    options: [
      "All monitoring stops until the queue is rebuilt by hand",
      "Domains keep their state but lose their schedule",
      "Webhook obligations are lost and have to be re-triggered",
      "In-flight attempts are lost and no obligation is, because Postgres holds both what is due and what is owed",
    ],
    prompt: "What is lost if Redis is flushed?",
    source: ".claude/CLAUDE.md",
  },
  {
    correct: 0,
    explanation:
      "By the time a job runs, the row it names may have been re-registered, re-profiled or deleted, so a payload carrying a copy of any of that acts on a snapshot that is no longer true. Re-reading costs one indexed lookup and removes the class of bug — and it is what makes a flushed Redis survivable.",
    id: "unit7:payload",
    options: [
      "Identifiers only, because the row may have changed by the time the job runs",
      "The domain and its compiled profile, to save a query",
      "The last known result, so the worker can compare",
      "Whatever the enqueueing code has to hand",
    ],
    prompt: "What does a job payload carry?",
    source: "packages/jobs/src/payloads.ts",
  },
  {
    correct: 2,
    explanation:
      "BullMQ refuses to add a job whose id already exists, including one sitting in the completed set. With retention keeping tens of thousands of completed jobs, a domain checked daily still has yesterday's job present, so today's add is silently ignored and the domain stops being checked with no error anywhere.",
    id: "unit7:jobid-trap",
    options: [
      "Job ids must be globally unique across queues",
      "It leaks the domain id to anyone with queue access",
      "A completed job with the same id makes the next add a silent no-op, so the domain stops being checked",
      "It prevents retries from being distinguished from first attempts",
    ],
    prompt:
      "Why is deriving a BullMQ job id from the domain id a bug rather than de-duplication?",
    source: "apps/api/src/sweep/tick.ts",
  },
  {
    correct: 1,
    explanation:
      "A lease shorter than the check budget lets a slow-but-healthy check be claimed a second time while the first is still running. Five minutes over a ten-second budget is a wide margin, which is the point — the number is a tripwire, not a tuned value.",
    id: "unit7:lease",
    options: [
      "It must match the sweep interval exactly",
      "It must comfortably exceed the check budget, or a slow check gets claimed twice",
      "It must be shorter than the check budget, so stuck jobs are retried quickly",
      "It has to equal the observed TTL",
    ],
    prompt: "What constrains how long a claim lease on a due domain has to be?",
    source: "apps/api/src/sweep/tick.ts",
  },
  {
    correct: 3,
    explanation:
      "One verification aims up to twenty queries at authoritative servers the caller names — somebody else's infrastructure, at a rate the caller chooses. A hundred verifications a second is up to two thousand queries a second pointed at other people's nameservers.",
    id: "unit7:verify-quota",
    options: [
      "Because verifications are the most expensive database writes",
      "Because they hold a Postgres transaction open",
      "Because they cannot be cached",
      "Because one verification aims up to twenty queries at nameservers the caller names, so the cost falls on somebody else",
    ],
    prompt:
      "Why is the verification quota so much lower than the general request quota?",
    source: "docs/DESIGN.md",
  },
];
