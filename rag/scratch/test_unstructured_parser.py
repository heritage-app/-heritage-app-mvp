import re
import json

def parse_unstructured_bible(text):
    """
    Experimental parser for unstructured/copy-pasted Bible text.
    Handles 'Ga first, English second' layout with inline verse numbers.
    """
    # 1. Identify Sections
    # Split by the repeated book/chapter header or a large block of markers
    # In this case, 'Genesis 17' is a good marker for the second half
    parts = re.split(r'\nGenesis\s+17\n', text, flags=re.IGNORECASE)
    if len(parts) < 2:
        return []
    
    ga_block = parts[0]
    en_block = parts[1]
    
    # 2. Extract Verses from Blocks
    def extract_verses(block):
        # Look for digits at the start of sentences or segments
        # Pattern: Digit(s) followed by text
        # Regex: (\d+)\s*(.*?)(?=\s*\d+\s|$)
        # Using DOTALL to capture multi-line verses
        pattern = re.compile(r'(\d+)\s*(.*?)(?=\s*\d+\s|$)', re.DOTALL)
        matches = pattern.findall(block)
        return {int(m[0]): m[1].strip() for m in matches}
    
    ga_verses = extract_verses(ga_block)
    en_verses = extract_verses(en_block)
    
    # 3. Assemble
    records = []
    all_refs = sorted(list(set(ga_verses.keys()) | set(en_verses.keys())))
    
    for ref in all_refs:
        records.append({
            "ref": ref,
            "ga": ga_verses.get(ref, ""),
            "en": en_verses.get(ref, "")
        })
    
    return records

if __name__ == "__main__":
    # Test sample from user's snippet (shrot version)
    sample = """Jɛnɛsis 17
Ketiafoo akɛ Kpãŋmɔ lɛ he okadi
1  Be ni Abram eye afii nyɔŋmai nɛɛhu kɛ nɛɛhu lɛ, Yehowa jie ehe kpo... 2Mikɛ mikpãŋmɔ lɛ baaŋmɛ...

Genesis 17
1And when Abram was ninety years old and nine... 2And I will make my covenant..."""
    
    results = parse_unstructured_bible(sample)
    print(json.dumps(results, indent=2))
