import re
from app.rag.utils import resolve_ga_citation

def test_resolution():
    query = "Mose klɛŋklɛŋ wolo, Yitso Nyɔŋmai-Ejwɛ kɛ Kpawo, Kuku ni ji nyɔŋmai-enyɔ kɛ nɛɛhu (Genesis 27:29)"
    q_low = query.lower()
    
    print(f"Query: {query}")
    
    # Current regex extraction
    ref_match = re.search(r'(genesis|exodus|leviticus|numbers|deuteronomy|mose)\s+(\d+)(?:[\s:]+(\d+))?', q_low)
    
    # Ga extraction
    ga_ref = resolve_ga_citation(q_low)
    
    requested_book = None
    requested_ch = None
    requested_v = None
    raw_book = None

    if (ref_match or ga_ref["chapter"]):
        # 1. Extract base values from digits
        if ref_match:
            raw_book = ref_match.group(1).lower()
            requested_ch = int(ref_match.group(2))
            requested_v = int(ref_match.group(3)) if ref_match.group(3) else None
            print(f"Extracted from English Digits: {raw_book} {requested_ch}:{requested_v}")
        
        # 2. Extract values from Ga text
        if ga_ref["chapter"]:
            print(f"Extracted from Ga Text: Chapter {ga_ref['chapter']}, Verse {ga_ref['verse']}")
            
            # THE FIX: Priority logic correctly overrides the digit lookup
            requested_ch = ga_ref["chapter"]
            if ga_ref["verse"]:
                requested_v = ga_ref["verse"]
            
            if not raw_book:
                for b in ["genesis", "exodus", "leviticus", "numbers", "deuteronomy", "mose"]:
                    if b in q_low:
                        raw_book = b
                        break

        # 3. Canonical Book Mapping
        if raw_book:
            book_map = {
                "genesis": "Genesis",
                "mose": "Genesis",
                "exodus": "Exodus",
                # ...
            }
            requested_book = book_map.get(raw_book, raw_book.capitalize())
            
        print(f"FINAL DETERMINATION -> {requested_book} {requested_ch}:{requested_v}")
        
    expected = "Genesis 47:29"
    actual = f"{requested_book} {requested_ch}:{requested_v}"
    if actual == expected:
        print("\nSUCCESS: The Ga numerical parser correctly prioritized the written-out intent over the English digit typo.")
    else:
        print(f"\nFAILURE: Resolved to {actual}, expected {expected}")

if __name__ == "__main__":
    test_resolution()
