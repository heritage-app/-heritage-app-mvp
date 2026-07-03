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
  { text: 'akpeteshi', type: 'phrase', description: 'Local gin', phonetic: 'ahk-peh-TEH-shee', english: 'akpeteshie' },
  { text: 'akwei', type: 'phrase', description: 'Thank you', phonetic: 'ah-KWAY', english: 'thank you' },
  { text: 'ɛdzɛ', type: 'phrase', description: 'Good/fine', phonetic: 'eh-DZEH', english: 'good' },
  { text: 'heɛ', type: 'phrase', description: 'Yes', phonetic: 'hay', english: 'yes' },
  { text: 'daabi', type: 'phrase', description: 'No', phonetic: 'dah-BEE', english: 'no' },
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
  { text: 'nyɔŋmai ekome', type: 'number', description: 'Twenty (20)', phonetic: 'nyawng-MYE eh-KOH-meh', english: 'twenty' },
  { text: 'nyɔŋmai enyɔ', type: 'number', description: 'Forty (40)', phonetic: 'nyawng-MYE eh-NYAW', english: 'forty' },
  { text: 'nyɔŋmai etɛ', type: 'number', description: 'Thirty (30)', phonetic: 'nyawng-MYE eh-TAY', english: 'thirty' },
];

/**
 * Get Ga suggestions based on partial input
 */
export function getGaSuggestions(partial: string, limit: number = 8): GaSuggestion[] {
  if (!partial || partial.length < 1) return [];

  const normalized = partial.toLowerCase().trim();
  
  return GA_VOCABULARY
    .filter(suggestion => 
      suggestion.text.toLowerCase().includes(normalized) ||
      suggestion.description?.toLowerCase().includes(normalized)
    )
    .slice(0, limit);
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