"""
Utility functions for RAG processing, including Ga numerical parsing.
"""

import re
from typing import Dict, Any, Optional

def num_to_ga(n: int) -> str:
    """Implements the Universal Ga Numerical Formula for 1-999."""
    units = {1: "ekome", 2: "enyɔ", 3: "etɛ", 4: "ejwɛ", 5: "enumɔ", 
             6: "ekpaa", 7: "kpawo", 8: "kpaanyɔ", 9: "nɛɛhu"}
    if n <= 0: return str(n)
    if 1 <= n <= 9: return units[n]
    if n == 10: return "nyɔŋma"
    if 11 <= n <= 19: return f"nyɔŋma kɛ {units[n-10]}"
    if n % 10 == 0:
        if n < 100: return f"nyɔŋmai {units[n//10]}"
        if n == 100: return "oha"
    if n < 100:
        tens = n // 10
        rem = n % 10
        return f"nyɔŋmai {units[tens]} kɛ {units[rem]}"
    
    # Simple fallback for 100+ for now, can be expanded to full recursive formula
    return str(n)

def ga_to_num(ga_text: str) -> Optional[int]:
    """
    Parses a Ga number string (e.g., 'nyɔŋmai-enyɔ kɛ nɛɛhu') into an integer.
    Supports numbers 1-99 based on common Bible numbering.
    """
    if not ga_text:
        return None
    
    # Normalize
    t = ga_text.lower().replace("-", " ").strip()
    
    # Exact mappings for units
    units = {"ekome": 1, "enyɔ": 2, "etɛ": 3, "ejwɛ": 4, "enumɔ": 5, 
             "ekpaa": 6, "kpawo": 7, "kpaanyɔ": 8, "nɛɛhu": 9}
    
    if t in units:
        return units[t]
    if t == "nyɔŋma":
        return 10
    
    # Handle teens: "nyɔŋma kɛ [unit]"
    teen_match = re.search(r'nyɔŋma\s+kɛ\s+(\w+)', t)
    if teen_match:
        unit_val = units.get(teen_match.group(1))
        if unit_val: return 10 + unit_val
        
    # Handle tens: "nyɔŋmai [unit]" or "nyɔŋmai [unit] kɛ [unit]"
    tens_prefix_match = re.search(r'nyɔŋmai\s+(\w+)', t)
    if tens_prefix_match:
        ten_unit = tens_prefix_match.group(1)
        ten_val = units.get(ten_unit)
        if ten_val:
            base = ten_val * 10
            # Check for remainder
            rem_match = re.search(r'kɛ\s+(\w+)', t)
            if rem_match:
                rem_unit = rem_match.group(1)
                rem_val = units.get(rem_unit)
                if rem_val: return base + rem_val
            return base
            
    # Handle pure digits if provided as string
    digit_match = re.search(r'\d+', t)
    if digit_match:
        return int(digit_match.group(0))
        
    return None

def resolve_ga_citation(text: str) -> Dict[str, Optional[int]]:
    """
    Extracts chapter and verse from Ga text.
    Handles 'Yitso [Num]' and 'Kuku (ni ji) [Num]'.
    """
    res = {"chapter": None, "verse": None}
    
    # Normalize
    t = text.lower()
    
    # Parse Chapter
    ch_match = re.search(r'yitso\s+([^,]+)', t)
    if ch_match:
        res["chapter"] = ga_to_num(ch_match.group(1).strip())
        
    # Parse Verse
    # Greedy match until the next marker (bracket or colon) or end of string.
    # We allow spaces now to capture "nyɔŋmai enyɔ kɛ nɛɛhu"
    v_match = re.search(r'kuku\s+(?:ni\s+ji\s+)?([^:(]+)', t)
    if v_match:
        # Clean up potential trailing punctuation
        v_str = v_match.group(1).strip().rstrip(',.')
        res["verse"] = ga_to_num(v_str)
        
    return res
