// Temp smoke test for the loosened listTopic matcher (service.ts).
// Run: node scripts/tmp-list-ask-test.mjs

const foldGa = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ŋ/g, "n")
    .replace(/ɛ/g, "e")
    .replace(/ɔ/g, "o");

const norm = (s) =>
  foldGa(s.toLowerCase()).replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const LIST_TOPIC_WORDS =
  "months?(?:\\s+of\\s+the\\s+year)?|days?(?:\\s+of\\s+the\\s+week)?|weekdays|colou?rs|numbers?|numerals|animals|birds|insects|fish(?:es)?|body\\s+parts|family(?:\\s+(?:members|words|terms))?|foods?|weather(?:\\s+words)?|greetings|drinks|pronouns|fruits?|samai|symbols?";
// Optional fillers allowed between the list verb and the topic.
const LIST_FILLER = "(?:all|the|names?|of|things\\s+about)\\s+";
const LIST_TOPIC_RE = new RegExp(
  `\\b(?:list|name|enumerate|what\\s+are|which\\s+are|how\\s+many|give\\s+me|show\\s+me|tell\\s+me|all(?:\\s+the)?)\\s+(?:${LIST_FILLER})*(?:\\d+\\s+|ga\\s+)?(?<topic>${LIST_TOPIC_WORDS})\\b`,
  "i"
);
const LIST_TOPIC_BARE_RE = new RegExp(
  `^(?:(?:ga|all|the|names?|of|things\\s+about)\\s+)*(${LIST_TOPIC_WORDS})$`,
  "i"
);

function listTopicOf(query) {
  return (
    query.match(LIST_TOPIC_RE)?.groups?.topic ??
    norm(query.trim().replace(/[?!.]+$/, "").replace(/\s+(?:in|into)\s+ga(?:\s+language)?$/i, ""))
      .match(LIST_TOPIC_BARE_RE)?.[1] ??
    null
  );
}

const twKey = (t) => {
  const tw = norm(t).replace(/\s+of\s+the\s+(?:week|year)$/, "");
  return (
    (/^month/.test(tw) && "months") ||
    (/^day|^weekday/.test(tw) && "days") ||
    (/^colo/.test(tw) && "colours") ||
    (/^num/.test(tw) && "numbers") ||
    (/^bod/.test(tw) && "body") ||
    (/^famil/.test(tw) && "family") ||
    (/^food/.test(tw) && "food") ||
    (/^weather/.test(tw) && "weather") ||
    (/^fruit/.test(tw) && "fruits") ||
    (/^fish/.test(tw) && "fish") ||
    (/^drink/.test(tw) && "drinks") ||
    (/^pronoun/.test(tw) && "pronouns") ||
    (/^greet/.test(tw) && "greetings") ||
    (/^insect/.test(tw) && "insects") ||
    (/^bird/.test(tw) && "birds") ||
    (/^animal/.test(tw) && "animals") ||
    (/^samai|^symb/.test(tw) && "samai") ||
    null
  );
};

// Mirrors of the other askGeneral matchers (service.ts) — kept in sync so this
// smoke test exercises the same routing decisions.
const sentenceAsk = (q) =>
  q.match(/\b(?:use|put|say)\s+(?:it\s+)?["“']?(.+?)["”']?\s+in\s+a\s+sentence\b/i) ||
  q.match(/^(?:(?:the\s+)?(?:word|phrase|term)\s+)?["“']?(.+?)["”']?\s+in\s+a\s+sentence\b/i) ||
  q.match(/\b(?:make|give|show|write|compose|form)\b(?:\s+me)?\s+a\s+sentence\s+(?:with|using|for|containing|that\s+uses?)\s+["“']?(.+?)["”']?\s*[?!.]*$/i);

const SELF_RE =
  /^(?:who are you|what are you|what['’]?s your name|what is your name|who is nii obodai|what can you do|introduce yourself|tell me about yourself)\b/i;

const diffAsk = (q) =>
  q.match(/(?:difference|distinction|contrast)(?:\s+between)?\s+["“']?(.+?)["”']?\s+(?:and|vs\.?|versus)\s+["“']?(.+?)["”']?\s*(?:in\s+ga)?[?!.\s]*$/i) ||
  q.match(/^["“']?(.+?)["”']?\s+(?:vs\.?|versus)\s+["“']?(.+?)["”']?\s*(?:in\s+ga)?[?!.\s]*$/i) ||
  q.match(/^compare\s+["“']?(.+?)["”']?\s+(?:and|with|to|vs\.?|versus)\s+["“']?(.+?)["”']?\s*(?:in\s+ga)?[?!.\s]*$/i);

// The guard the engine applies on top of a match.
const blocked = (q) =>
  /\b(tell|read|recite|sing|share|give|show)\b[\s\S]*\b(stor(?:y|ies)|tales?|folktales?|legends?|poems?|poetry|songs?)\b/i.test(q) ||
  /\bin\s+a\s+sentence\b/i.test(q) ||
  /^\s*(?:how\s+do\s+you\s+say|what\s+is\s+the\s+ga\s+for|translate)\b/i.test(q);

const cases = [
  // [query, expected topic key (null = must not match)]
  ["list the names of the months in ga", "months"],
  ["list the months in ga", "months"],
  ["what are all the days of the week", "days"],
  ["how many colours are there", "colours"],
  ["what does the fish eat", null],
  ["my names are", null],
  ["months names", null],
  ["months", "months"],
  ["days", "days"],
  ["the days", "days"],
  ["name the animals", "animals"],
  ["greetings", "greetings"],
  ["Tsatsu in a sentence", null],
  ["how do you say month in ga", null],
  // extra positives from the spec
  ["tell me the months", "months"],
  ["what are all the months", "months"],
  ["list months", "months"],
  ["the months of the year", "months"],
  ["the family", "family"],
  ["list all the names of the colours", "colours"],
  ["tell me things about the animals", "animals"],
  ["how many months are there", "months"],
  ["what are the names of the months", "months"],
  ["names of the months", "months"],
  // FIX F — samai list topic
  ["list the names of the ga samai", "samai"],
  ["the ga samai", "samai"],
  ["symbols in ga", "samai"],
  // must NOT route as lists
  ["what is homowo", null],
  ["use efɔŋ in a sentence", null],
];

// [query, matcher, should-match] — FIX B/C/D/E routing probes.
const matchCases = [
  ["form a sentence using hɛloo", sentenceAsk, true],
  ["use efɔŋ in a sentence", sentenceAsk, true],
  ["who are you", (q) => q.match(SELF_RE), true],
  ["difference between efɔŋ and gbonyo", diffAsk, true],
  ["efɔŋ vs gbonyo", diffAsk, true],
  ["what is the difference between fɔŋ and efɔŋ", diffAsk, true],
];

let pass = 0, fail = 0;
for (const [q, want] of cases) {
  const t = listTopicOf(q);
  const got = t && !blocked(q) ? twKey(t) : null;
  const ok = got === want;
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${JSON.stringify(q)}  ->  ${JSON.stringify(got)}  (want ${JSON.stringify(want)}, topic=${JSON.stringify(t)})`);
}
for (const [q, matcher, want] of matchCases) {
  const got = !!matcher(q);
  const ok = got === want;
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${JSON.stringify(q)}  ->  matched=${got}  (want ${want})`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
