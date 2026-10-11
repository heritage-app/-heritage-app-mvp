/**
 * Dynamic Ga greeting system for frontend
 * Matches backend greeting logic for consistency
 */

export interface GreetingContext {
  timeOfDay?: 'morning' | 'afternoon' | 'evening';
  conversationType?: 'learning' | 'bible' | 'cultural' | 'general';
  formality?: 'formal' | 'casual' | 'warm';
}

export interface GaGreeting {
  ga: string;
  english: string;
  context: GreetingContext;
  useCase: string;
}

/**
 * Get current time of day
 */
export function getTimeOfDay(): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}

/**
 * Ga greeting database (matches backend).
 * Every phrase is verified against the indexed Ga Language Guide archive
 * (rag-cloudflare/datasets/ga-language-guide*.jsonl, topic "greetings") — do
 * not add greetings from memory: earlier drafts mixed in Twi ("Maakye",
 * "Maadwo", "Afehyia pa") and invented phrases ("Akwei", "Nii shi", "ɛdzɛnɔ").
 */
const GA_GREETINGS: GaGreeting[] = [
  // Time-based greetings
  {
    ga: "Ojekoo!",
    english: "Good morning!",
    context: { timeOfDay: 'morning', formality: 'warm' },
    useCase: "Morning greeting"
  },
  {
    ga: "Owɔŋ!",
    english: "Good morning!",
    context: { timeOfDay: 'morning', formality: 'formal' },
    useCase: "Morning greeting, alternate form"
  },
  {
    ga: "Oshwiee!",
    english: "Good afternoon!",
    context: { timeOfDay: 'afternoon', formality: 'warm' },
    useCase: "Afternoon greeting"
  },
  {
    ga: "M'naokoo!",
    english: "Good evening!",
    context: { timeOfDay: 'evening', formality: 'warm' },
    useCase: "Evening greeting"
  },

  // General/Universal greetings
  {
    ga: "Hɛloo naanyo!",
    english: "Hello, friend!",
    context: { formality: 'warm' },
    useCase: "Warm welcome, any time"
  },
  {
    ga: "Miifala!",
    english: "Welcome!",
    context: { formality: 'warm' },
    useCase: "Welcoming someone"
  },
  {
    ga: "Miihere bo!",
    english: "I welcome you!",
    context: { formality: 'casual' },
    useCase: "Welcoming someone, alternate form"
  },
  {
    ga: "Oyiwaladɔŋ!",
    english: "Thank you!",
    context: { formality: 'casual' },
    useCase: "Gratitude"
  },
  {
    ga: "Yaaba jogbaŋŋ!",
    english: "Goodbye!",
    context: { formality: 'casual' },
    useCase: "Farewell"
  },
  {
    ga: "Wɔ jogbaŋŋ!",
    english: "Good night!",
    context: { formality: 'casual' },
    useCase: "Night-time farewell"
  },

  // Learning-specific greetings
  {
    ga: "Miyɛ jogbaŋŋ!",
    english: "I am fine!",
    context: { conversationType: 'learning', formality: 'casual' },
    useCase: "Response to 'how are you', learning context"
  },
  {
    ga: "Atsɛɔ mi Nii Obodai!",
    english: "My name is Nii Obodai!",
    context: { conversationType: 'general', formality: 'warm' },
    useCase: "Introduction"
  },

  // Cultural/traditional greetings
  {
    ga: "Te oyɔɔ tɛŋ?",
    english: "How are you?",
    context: { conversationType: 'cultural', formality: 'warm' },
    useCase: "Friendly cultural greeting"
  },
  {
    ga: "Omanye!",
    english: "Congratulations!",
    context: { conversationType: 'cultural', formality: 'warm' },
    useCase: "Congratulating someone"
  },
];

/**
 * Get appropriate greeting based on context
 */
export function getDynamicGreeting(context: Partial<GreetingContext> = {}): GaGreeting {
  const timeOfDay = context.timeOfDay || getTimeOfDay();
  const conversationType = context.conversationType || 'general';
  const formality = context.formality || 'warm';

  // Priority 1: Time-based greetings
  const timeGreetings = GA_GREETINGS.filter(g => 
    g.context.timeOfDay === timeOfDay && 
    g.context.formality === formality
  );
  
  if (timeGreetings.length > 0) {
    return timeGreetings[Math.floor(Math.random() * timeGreetings.length)];
  }

  // Priority 2: Conversation type
  const typeGreetings = GA_GREETINGS.filter(g => 
    g.context.conversationType === conversationType &&
    g.context.formality === formality
  );
  
  if (typeGreetings.length > 0) {
    return typeGreetings[Math.floor(Math.random() * typeGreetings.length)];
  }

  // Priority 3: Formality only
  const formalityGreetings = GA_GREETINGS.filter(g => 
    g.context.formality === formality
  );
  
  if (formalityGreetings.length > 0) {
    return formalityGreetings[Math.floor(Math.random() * formalityGreetings.length)];
  }

  // Fallback to universal warm greeting
  return GA_GREETINGS.find(g => g.ga === "Hɛloo naanyo!") || GA_GREETINGS[0];
}

/**
 * Get greeting specifically for learning opportunities
 */
export function getLearningGreeting(): string {
  const timeOfDay = getTimeOfDay();
  const learningGreetings = GA_GREETINGS.filter(g => 
    g.context.conversationType === 'learning' || 
    g.context.formality === 'warm'
  );
  
  // Prioritize time-appropriate warm greetings
  const timeWarmGreetings = GA_GREETINGS.filter(g => 
    g.context.timeOfDay === timeOfDay && 
    g.context.formality === 'warm'
  );
  
  if (timeWarmGreetings.length > 0) {
    return timeWarmGreetings[Math.floor(Math.random() * timeWarmGreetings.length)].ga;
  }
  
  if (learningGreetings.length > 0) {
    return learningGreetings[Math.floor(Math.random() * learningGreetings.length)].ga;
  }
  
  // Fallback options with variety
  const fallbackGreetings = [
    "Hɛloo naanyo!",
    "Miifala!",
    "Miihere bo!"
  ];
  
  return fallbackGreetings[Math.floor(Math.random() * fallbackGreetings.length)];
}

/**
 * Simple greeting getter (most commonly used)
 */
export function getGreeting(): string {
  return getDynamicGreeting().ga;
}

/**
 * Get greeting with English translation
 */
export function getGreetingWithTranslation(): string {
  const greeting = getDynamicGreeting();
  return `${greeting.ga} (${greeting.english})`;
}