/**
 * Query expansion and intelligent retrieval strategies
 * Improves the model's ability to learn from and utilize its knowledge base
 */

import type { Env } from "../types";
import { embedOne } from "./embeddings";
import { retrieveContext, type RetrieveOptions } from "./retriever";
import { BIBLE_BOOK_TOKENS, BOOK_MAP } from "../config";

/**
 * Query expansion with related terms and synonyms
 */
export async function expandQuery(query: string, env: Env): Promise<string[]> {
  const expansions: string[] = [query];
  const lowerQuery = query.toLowerCase();

  // Bible citation expansions
  if (BIBLE_BOOK_TOKENS.some(token => lowerQuery.includes(token))) {
    for (const token of BIBLE_BOOK_TOKENS) {
      if (lowerQuery.includes(token)) {
        const canonicalBook = BOOK_MAP[token] || token.charAt(0).toUpperCase() + token.slice(1);
        expansions.push(query.replace(token, canonicalBook));
        
        // Add number variations
        const numMatch = query.match(/\d+/g);
        if (numMatch) {
          numMatch.forEach(num => {
            expansions.push(query.replace(num, `${num}st`));
            expansions.push(query.replace(num, `${num}nd`));
            expansions.push(query.replace(num, `${num}rd`));
            expansions.push(query.replace(num, `${num}th`));
          });
        }
      }
    }
  }

  // Ga number expansions
  const gaNumbers = {
    'ekome': '1', 'enyɔ': '2', 'etɛ': '3', 'ejwɛ': '4', 'enumɔ': '5',
    'ekpaa': '6', 'kpawo': '7', 'kpaanyɔ': '8', 'nɛɛhu': '9', 'nyɔŋma': '10'
  };
  
  for (const [ga, en] of Object.entries(gaNumbers)) {
    if (lowerQuery.includes(ga)) {
      expansions.push(query.replace(ga, en));
      expansions.push(query.replace(ga, `number ${en}`));
    }
  }

  // Ga term expansions
  const termExpansions: Record<string, string[]> = {
    'yitso': ['chapter', 'Chapter'],
    'kuku': ['verse', 'Verse'],
    'kuku ni ji': ['verse', 'Verse'],
    'bibele': ['bible', 'Bible', 'scripture'],
  };

  for (const [ga, englishVariants] of Object.entries(termExpansions)) {
    if (lowerQuery.includes(ga)) {
      englishVariants.forEach(variant => {
        expansions.push(query.replace(ga, variant));
      });
    }
  }

  // Light morphological variant: singular forms help the embedding find
  // records phrased differently (e.g. "alphabets in Ga" → "alphabet in Ga").
  // [^s] before the final 's' keeps "miss"/"this"/"class" untouched.
  const singularized = query.replace(/\b([a-z]{3,}[^s])s\b/gi, "$1");
  if (singularized !== query) expansions.push(singularized);

  // Remove duplicates while preserving order
  return [...new Set(expansions)];
}

/**
 * Classification of query type for adaptive retrieval
 */
export type QueryType = 
  | 'bible_citation' 
  | 'cultural_question' 
  | 'translation_request' 
  | 'general_query'
  | 'numerical'
  | 'overview';

export function classifyQuery(query: string): QueryType {
  const lower = query.toLowerCase();

  // Bible citation (e.g., "Genesis 1:1", "Yitso ekome")
  if (BIBLE_BOOK_TOKENS.some(token => lower.includes(token)) && /\d/.test(lower)) {
    return 'bible_citation';
  }

  // Numerical queries
  if (/ekome|enyɔ|etɛ|ejwɛ|enumɔ|ekpaa|kpawo|kpaanyɔ|nɛɛhu|nyɔŋma/.test(lower)) {
    return 'numerical';
  }

  // Translation requests
  if (lower.includes('translate') || lower.includes('in ga') || lower.includes('in english')) {
    return 'translation_request';
  }

  // Archive overview
  if (['what do you have', 'what is available', 'what books', 'overview', 'contents'].some(p => lower.includes(p))) {
    return 'overview';
  }

  // Cultural questions
  if (lower.includes('culture') || lower.includes('tradition') || lower.includes('custom')) {
    return 'cultural_question';
  }

  return 'general_query';
}

/**
 * Adaptive retrieval options based on query type
 */
export function getAdaptiveOptions(queryType: QueryType): Partial<RetrieveOptions> {
  switch (queryType) {
    case 'bible_citation':
      return {
        topK: 3, // High precision needed
        filters: { category: 'bible' }
      };
    
    case 'cultural_question':
      return {
        topK: 8, // Broader search for cultural context
        allowedCategories: ['heritage', 'stories']
      };
    
    case 'translation_request':
      return {
        topK: 5,
        allowedCategories: ['stories', 'heritage']
      };
    
    case 'numerical':
      return {
        topK: 2, // Numbers are precise
      };
    
    case 'overview':
      return {
        topK: 1, // Will be handled specially
      };
    
    default:
      return {
        topK: 5, // Default balanced approach
      };
  }
}

/**
 * Multi-query retrieval with expansion
 */
export async function retrieveWithExpansion(
  env: Env,
  query: string,
  baseOptions: RetrieveOptions = {}
): Promise<{ nodes: any[]; usedQuery: string }> {
  const queryType = classifyQuery(query);
  const adaptiveOptions = getAdaptiveOptions(queryType);
  // Caller options win: each engine knows its category scope and candidate-pool
  // size; adaptive values only fill in what the caller left unspecified.
  const combinedOptions = { ...adaptiveOptions, ...baseOptions };

  // For precise citations, don't expand
  if (queryType === 'bible_citation' || queryType === 'numerical') {
    const nodes = await retrieveContext(env, query, combinedOptions);
    return { nodes, usedQuery: query };
  }

  // For other queries, try expansion
  const expandedQueries = await expandQuery(query, env);
  
  // Try each expansion and collect results
  const allResults = await Promise.all(
    expandedQueries.map(async (expandedQuery) => {
      const nodes = await retrieveContext(env, expandedQuery, combinedOptions);
      return { query: expandedQuery, nodes };
    })
  );

  // Merge and deduplicate results
  const seen = new Map<string, any>();
  for (const result of allResults) {
    for (const node of result.nodes) {
      const key = node.text?.slice(0, 200) || JSON.stringify(node.metadata);
      const existing = seen.get(key);
      if (!existing || node.score > existing.score) {
        seen.set(key, { ...node, matchedQuery: result.query });
      }
    }
  }

  const mergedNodes = Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, combinedOptions.topK || 5);

  return { 
    nodes: mergedNodes, 
    usedQuery: mergedNodes[0]?.matchedQuery || query 
  };
}

/**
 * Analyze query complexity for dynamic context sizing
 */
export function analyzeQueryComplexity(query: string): 'low' | 'medium' | 'high' {
  const lower = query.toLowerCase();
  let complexityScore = 0;

  // Length factor
  if (query.length > 50) complexityScore += 1;
  if (query.length > 100) complexityScore += 1;

  // Question words
  if (/\b(what|how|why|when|where|who|which|explain|describe)\b/.test(lower)) {
    complexityScore += 1;
  }

  // Multiple concepts
  const concepts = query.split(/\s+(?:and|or|but|with|about)\s+/).length;
  if (concepts > 2) complexityScore += 1;

  // Citations or references
  if (/\d+:\d+|chapter|verse|yitso|kuku/.test(lower)) {
    complexityScore += 1;
  }

  if (complexityScore >= 4) return 'high';
  if (complexityScore >= 2) return 'medium';
  return 'low';
}