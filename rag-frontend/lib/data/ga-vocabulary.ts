/**
 * Ga language vocabulary for auto-suggestions
 * Extracted from the RAG knowledge base including Bible terms, numbers, and common phrases
 */

export interface GaSuggestion {
  text: string;
  type: 'number' | 'bible' | 'phrase' | 'greeting' | 'book';
  description?: string;
  phonetic?: string;
  category?: string;
  context?: string;
  english?: string;
}

export const GA_VOCABULARY: GaSuggestion[] = [
  // Ga Numbers (1-9) with phonetics
  { text: 'ekome', type: 'number', description: 'One (1)', phonetic: 'eh-KOH-meh', english: 'one' },
  { text: 'enyɔ', type: 'number', description: 'Two (2)', phonetic: 'eh-NYAW', english: 'two' },
  { text: 'etɛ', type: 'number', description: 'Three (3)', phonetic: 'eh-TAY', english: 'three' },
  { text: 'ejwɛ', type: 'number', description: 'Four (4)', phonetic: 'eh-JWAY', english: 'four' },
  { text: 'enumɔ', type: 'number', description: 'Five (5)', phonetic: 'eh-NOO-maw', english: 'five' },
  { text: 'ekpaa', type: 'number', description: 'Six (6)', phonetic: 'eh-PAH', english: 'six' },
  { text: 'kpawo', type: 'number', description: 'Seven (7)', phonetic: 'KPAH-woh', english: 'seven' },
  { text: 'kpaanyɔ', type: 'number', description: 'Eight (8)', phonetic: 'KPAH-nyaw', english: 'eight' },
  { text: 'nɛɛhu', type: 'number', description: 'Nine (9)', phonetic: 'nay-ay-HOO', english: 'nine' },
  { text: 'nyɔŋma', type: 'number', description: 'Ten (10)', phonetic: 'nyawng-MAH', english: 'ten' },
  { text: 'oha', type: 'number', description: 'Hundred (100)', phonetic: 'OH-hah', english: 'hundred' },

  // Bible Terms with phonetics
  { text: 'Yitso', type: 'bible', description: 'Chapter', phonetic: 'YEE-tsoh', english: 'chapter' },
  { text: 'Kuku ni ji', type: 'bible', description: 'Verse', phonetic: 'KOO-koo nee jee', english: 'verse' },
  { text: 'Bibele', type: 'bible', description: 'Bible', phonetic: 'BEE-beh-leh', english: 'bible' },
  { text: 'kuku', type: 'bible', description: 'Verse (short)', phonetic: 'KOO-koo', english: 'verse' },

  // Bible Books with phonetics
  { text: 'Genesis', type: 'book', description: 'First book of Moses', phonetic: 'JEN-eh-sis', english: 'Genesis' },
  { text: 'Mose', type: 'book', description: 'Genesis (Ga name)', phonetic: 'MOH-seh', english: 'Moses' },
  { text: 'Exodus', type: 'book', description: 'Second book', phonetic: 'EK-suh-dus', english: 'Exodus' },
  { text: 'Leviticus', type: 'book', description: 'Third book', phonetic: 'leh-VIT-ih-kus', english: 'Leviticus' },
  { text: 'Numbers', type: 'book', description: 'Fourth book', phonetic: 'NUM-burs', english: 'Numbers' },
  { text: 'Deuteronomy', type: 'book', description: 'Fifth book', phonetic: 'doo-ter-ON-eh-mee', english: 'Deuteronomy' },

  // Common Phrases with phonetics
  { text: 'Hɛloo naanyo', type: 'greeting', description: 'Hello/welcome greeting', phonetic: 'hay-LOO nahn-YOH', english: 'hello/welcome' },
  { text: 'nyɔŋmai', type: 'phrase', description: 'Tens (20, 30, etc.)', phonetic: 'nyawng-MYE', english: 'tens' },
  { text: 'kɛ', type: 'phrase', description: 'And/plus (in numbers)', phonetic: 'kay', english: 'and' },

  // Additional Common Ga Words
  { text: 'niyeenii', type: 'phrase', description: 'Food', phonetic: 'nee-YEH-nee', english: 'food' },
  { text: 'nunumɔ', type: 'phrase', description: 'Drink', phonetic: 'noo-NOO-maw', english: 'drink' },
  { text: 'daa', type: 'phrase', description: 'Alcohol', phonetic: 'dah', english: 'alcohol' },
  { text: 'ngɔngmɛ', type: 'phrase', description: 'Palm wine', phonetic: 'ngong-meh', english: 'palm wine' },
  { text: 'akpeteshi', type: 'phrase', description: 'Raw/dry gin (local distilled spirit)', phonetic: 'ahk-peh-TEH-shee', english: 'raw dry gin' },
  { text: 'nmɛdaa', type: 'phrase', description: 'Corn wine', phonetic: 'n-meh-DAH', english: 'corn wine' },
  { text: 'asaana', type: 'phrase', description: 'Caramelized corn drink', phonetic: 'ah-SAH-nah', english: 'asaana' },
  { text: 'sobolo', type: 'phrase', description: 'Spiced hibiscus drink', phonetic: 'soh-BOH-loh', english: 'sobolo' },
  { text: 'lamugin', type: 'phrase', description: 'Spiced ginger drink', phonetic: 'lah-moo-GEEN', english: 'lamugin' },
  { text: 'Oyiwaladɔŋ', type: 'phrase', description: 'Thank you', phonetic: 'oh-yee-wah-lah-DAWNG', english: 'thank you' },
  { text: 'Hɛɛ', type: 'phrase', description: 'Yes', phonetic: 'hay', english: 'yes' },
  { text: 'Dabi', type: 'phrase', description: 'No', phonetic: 'DAH-bee', english: 'no' },
  { text: 'Mi nɔ', type: 'greeting', description: 'I am here', phonetic: 'mee naw', english: 'I am here' },
  { text: 'Ɛfe', type: 'greeting', description: 'How are you?', phonetic: 'eh-feh', english: 'how are you?' },
  { text: 'me fe', type: 'greeting', description: 'I am fine', phonetic: 'meh feh', english: 'I am fine' },

  // Common Query Patterns
  { text: 'Yitso ekome', type: 'bible', description: 'Chapter 1', phonetic: 'YEE-tsoh eh-KOH-meh', english: 'Chapter 1' },
  { text: 'Yitso enyɔ', type: 'bible', description: 'Chapter 2', phonetic: 'YEE-tsoh eh-NYAW', english: 'Chapter 2' },
  { text: 'Yitso etɛ', type: 'bible', description: 'Chapter 3', phonetic: 'YEE-tsoh eh-TAY', english: 'Chapter 3' },
  { text: 'Kuku ni ji ekome', type: 'bible', description: 'Verse 1', phonetic: 'KOO-koo nee jee eh-KOH-meh', english: 'Verse 1' },
  { text: 'Kuku ni ji enyɔ', type: 'bible', description: 'Verse 2', phonetic: 'KOO-koo nee jee eh-NYAW', english: 'Verse 2' },
  { text: 'Kuku ni ji etɛ', type: 'bible', description: 'Verse 3', phonetic: 'KOO-koo nee jee eh-TAY', english: 'Verse 3' },

  // Number Combinations
  { text: 'nyɔŋma kɛ ekome', type: 'number', description: 'Eleven (11)', phonetic: 'nyawng-MAH kay eh-KOH-meh', english: 'eleven' },
  { text: 'nyɔŋma kɛ enyɔ', type: 'number', description: 'Twelve (12)', phonetic: 'nyawng-MAH kay eh-NYAW', english: 'twelve' },
  // nyɔŋmai <unit> is unit × 10 — must match numToGa() in rag-cloudflare/src/rag/ga.ts,
  // which is what the chat engine answers with. (10 is nyɔŋma, not nyɔŋmai ekome.)
  { text: 'nyɔŋmai enyɔ', type: 'number', description: 'Twenty (20)', phonetic: 'nyawng-MYE eh-NYAW', english: 'twenty' },
  { text: 'nyɔŋmai etɛ', type: 'number', description: 'Thirty (30)', phonetic: 'nyawng-MYE eh-TAY', english: 'thirty' },
  { text: 'nyɔŋmai ejwɛ', type: 'number', description: 'Forty (40)', phonetic: 'nyawng-MYE eh-JWAY', english: 'forty' },
  // Greetings
  { text: 'Ojekoo', type: 'greeting', description: 'Good morning', phonetic: 'oh-JEH-koh', english: 'good morning' },
  { text: 'Oshwiee', type: 'greeting', description: 'Good afternoon', phonetic: 'oh-SHWEE-eh', english: 'good afternoon' },
  { text: "M'naokoo", type: 'greeting', description: 'Good evening', phonetic: 'mah-NOW-koh', english: 'good evening' },
  { text: 'Oyiwaladɔŋ', type: 'greeting', description: 'Thank you (formal)', phonetic: 'oh-yee-WAH-lah-dawng', english: 'thank you' },
  { text: 'Yaaba jogbaŋŋ', type: 'greeting', description: 'Goodbye', phonetic: 'YAH-bah jog-BANG', english: 'goodbye' },
  { text: 'Omanye', type: 'greeting', description: 'Congratulations', phonetic: 'oh-MAH-nyeh', english: 'congratulations' },
  { text: 'Miifala', type: 'greeting', description: 'Welcome', phonetic: 'mee-FAH-lah', english: 'welcome' },
  // Pronouns
  { text: 'Mi', type: 'phrase', description: 'I / me', phonetic: 'mee', english: 'I' },
  { text: 'Bo', type: 'phrase', description: 'You (singular)', phonetic: 'boh', english: 'you' },
  { text: 'Lɛ', type: 'phrase', description: 'He / she / it', phonetic: 'leh', english: 'him/her' },
  { text: 'Wɔ', type: 'phrase', description: 'We / us', phonetic: 'waw', english: 'we' },
  { text: 'Nyɛ', type: 'phrase', description: 'You (plural)', phonetic: 'nyeh', english: 'you all' },
  { text: 'Amɛ', type: 'phrase', description: 'They / them', phonetic: 'ah-MEH', english: 'they' },
  // Days of the week
  { text: 'Hɔgbaa', type: 'phrase', description: 'Sunday', phonetic: 'HAWNG-bah', english: 'Sunday' },
  { text: 'Ju', type: 'phrase', description: 'Monday', phonetic: 'joo', english: 'Monday' },
  { text: 'Jufɔ', type: 'phrase', description: 'Tuesday', phonetic: 'JOO-faw', english: 'Tuesday' },
  { text: 'Shɔ', type: 'phrase', description: 'Wednesday', phonetic: 'shaw', english: 'Wednesday' },
  { text: 'Soo', type: 'phrase', description: 'Thursday', phonetic: 'soh', english: 'Thursday' },
  { text: 'Sohaa', type: 'phrase', description: 'Friday', phonetic: 'soh-HAH', english: 'Friday' },
  { text: 'Hɔɔ', type: 'phrase', description: 'Saturday', phonetic: 'haw', english: 'Saturday' },
  // Time
  { text: 'Ŋmɛnɛ', type: 'phrase', description: 'Today', phonetic: 'ng-MEH-neh', english: 'today' },
  { text: 'Gbɛkɛ', type: 'phrase', description: 'Night', phonetic: 'gbeh-KEH', english: 'night' },
  { text: 'Afi', type: 'phrase', description: 'Year', phonetic: 'AH-fee', english: 'year' },
  { text: 'Leebi', type: 'phrase', description: 'Morning', phonetic: 'LEH-bee', english: 'morning' },
  { text: 'Gbi', type: 'phrase', description: 'Day', phonetic: 'gbi', english: 'day' },
  { text: 'Otsi', type: 'phrase', description: 'Week', phonetic: 'oh-CHEE', english: 'week' },
  // Family
  { text: 'Tsɛ', type: 'phrase', description: 'Father', phonetic: 'tseh', english: 'father' },
  { text: 'Bi', type: 'phrase', description: 'Child', phonetic: 'bee', english: 'child' },
  { text: 'Nuu', type: 'phrase', description: 'Man', phonetic: 'noo', english: 'man' },
  { text: 'Yoo', type: 'phrase', description: 'Woman', phonetic: 'yoh', english: 'woman' },
  { text: 'Nii', type: 'phrase', description: 'Grandfather', phonetic: 'nee', english: 'grandfather' },
  { text: 'Naa', type: 'phrase', description: 'Grandmother', phonetic: 'nah', english: 'grandmother' },
  // Food & common items
  { text: 'Nu', type: 'phrase', description: 'Water', phonetic: 'noo', english: 'water' },
  { text: 'Loo', type: 'phrase', description: 'Fish', phonetic: 'loh', english: 'fish' },
  { text: 'Akwadu', type: 'phrase', description: 'Banana', phonetic: 'ah-KWAH-doo', english: 'banana' },
  { text: 'Bodobodo', type: 'phrase', description: 'Bread', phonetic: 'boh-doh-BOH-doh', english: 'bread' },
  { text: 'Yɛlɛ', type: 'phrase', description: 'Yam', phonetic: 'YEH-leh', english: 'yam' },
  { text: 'Wolɔ', type: 'phrase', description: 'Egg', phonetic: 'woh-LAW', english: 'egg' },
  // Animals
  { text: 'Gbee', type: 'phrase', description: 'Dog', phonetic: 'gbeh', english: 'dog' },
  { text: 'Alɔnte', type: 'phrase', description: 'Cat', phonetic: 'ah-LAWN-teh', english: 'cat' },
  { text: 'Jata', type: 'phrase', description: 'Lion', phonetic: 'JAH-tah', english: 'lion' },
  // Common expressions
  { text: 'Ofainɛ', type: 'phrase', description: 'Please', phonetic: 'oh-fyeh-NEH', english: 'please' },
  { text: 'Gbɛ', type: 'phrase', description: 'Road / path', phonetic: 'gbeh', english: 'road' },
  { text: 'Ba biɛ', type: 'phrase', description: 'Come here', phonetic: 'bah bee-EH', english: 'come here' },
  { text: 'Mɛni nɛ?', type: 'phrase', description: 'What is this?', phonetic: 'MEH-nee neh', english: 'what is this?' },
  { text: 'Te oyɔɔ tɛŋ?', type: 'greeting', description: 'How are you?', phonetic: 'teh oh-YAW teng', english: 'how are you?' },
  { text: 'Ojogbaŋŋ', type: 'greeting', description: 'I am fine / very well', phonetic: 'oh-JOG-bang', english: 'I am fine' },
  { text: 'Shika', type: 'phrase', description: 'Money', phonetic: 'SHEE-kah', english: 'money' },
  { text: 'Akpe', type: 'number', description: 'Thousand (1000)', phonetic: 'ah-KPEH', english: 'thousand' },
  { text: 'Fã', type: 'number', description: 'Half', phonetic: 'fahng', english: 'half' },
];

/**
 * Get Ga suggestions based on partial input
 */
/**
 * Fold Ga letters to ASCII look-alikes so a user typing on a standard keyboard
 * ("otukwajan") matches the verified headword ("Otukwajaŋ"). Used for MATCHING
 * ONLY — the canonical spelling from the record is always what gets displayed.
 */
export function foldGa(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/ŋ/g, "n")
    .replace(/ɛ/g, "e")
    .replace(/ɔ/g, "o")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/**
 * Database-only autocomplete. Returns ONLY verified GA_VOCABULARY records,
 * ranked by similarity. Never invents words, never guesses spellings.
 * Ranking: exact (0) → Ga-word prefix (1) → Ga-word contains (2) →
 * English/description prefix (3) → English/description contains (4).
 * Ties broken by shorter headword (tightest match first).
 */
export function getGaSuggestions(partial: string, limit: number = 8): GaSuggestion[] {
  const q = foldGa((partial || "").trim());
  if (!q) return [];

  const scored: Array<{ s: GaSuggestion; rank: number }> = [];
  for (const s of GA_VOCABULARY) {
    const text = foldGa(s.text);
    const en = (s.english || "").toLowerCase();
    const desc = (s.description || "").toLowerCase();
    let rank = -1;
    if (text === q) rank = 0;
    else if (text.startsWith(q)) rank = 1;
    else if (text.includes(q)) rank = 2;
    else if (en.startsWith(q) || desc.startsWith(q)) rank = 3;
    else if (en.includes(q) || desc.includes(q)) rank = 4;
    if (rank >= 0) scored.push({ s, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.s.text.length - b.s.text.length);
  return scored.slice(0, limit).map((x) => x.s);
}

/**
 * Get suggestions by category
 */
export function getSuggestionsByCategory(category: GaSuggestion['type']): GaSuggestion[] {
  return GA_VOCABULARY.filter(s => s.type === category);
}

/**
 * Get all unique suggestion types
 */
export function getSuggestionTypes(): GaSuggestion['type'][] {
  return [...new Set(GA_VOCABULARY.map(s => s.type))];
}