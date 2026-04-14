import re

def test_parse_segment(seg, verse_num):
    lines = seg.strip().split('\n')
    
    # Target structure:
    # GA_TEXT
    # [verse_num]
    # ENG_TEXT
    
    # Try to find the line that is exactly the verse number or contains only the verse number
    mid_index = -1
    for i, line in enumerate(lines):
        clean_line = line.strip()
        if clean_line == str(verse_num):
            mid_index = i
            break
            
    if mid_index != -1:
        ga_lines = lines[:mid_index]
        eng_lines = lines[mid_index+1:]
    else:
        # Fallback: find any line containing just the digit
        for i, line in enumerate(lines):
            if re.match(rf'^\s*{verse_num}\s*$', line):
                mid_index = i
                break
        
        if mid_index != -1:
            ga_lines = lines[:mid_index]
            eng_lines = lines[mid_index+1:]
        else:
            # If still not found, return original as content
            return seg, "NONE", "NONE"

    # Join and clean
    ga_text = " ".join([l.strip() for l in ga_lines if l.strip()])
    eng_text = " ".join([l.strip() for l in eng_lines if l.strip()])
    
    # Updated dictionary matching indexer.py
    num_to_digit = {
        "ekome": "1", "enyɔ": "2", "etɛ": "3", "ejwɛ": "4", "enumɔ": "5", 
        "ekpaa": "6", "kpawo": "7", "kpaanyɔ": "8", "neehu": "9", "nyɔŋma": "10",
        "nyɔŋma kɛ ekome": "11", "nyɔŋma kɛ enyɔ": "12", "nyɔŋma kɛ etɛ": "13",
        "nyɔŋma kɛ ejwɛ": "14", "nyɔŋma kɛ enumɔ": "15"
    }
    
    # Clean redundancy: Remove leading Ga number word/phrase
    ga_text_lower = ga_text.lower()
    for phrase in sorted(num_to_digit.keys(), key=len, reverse=True):
        if ga_text_lower.startswith(phrase):
            ga_text = ga_text[len(phrase):].strip()
            break
    
    # Also strip leading labels if they exist
    if ga_text.lower().startswith("ga:"):
        ga_text = ga_text[3:].strip()
    if eng_text.lower().startswith("english:"):
        eng_text = eng_text[8:].strip()

    return ga_text, eng_text

# Test case from USER_REQUEST
seg = """enumɔ
Lot ni kɛ Abram nyiɛ lɛ hu yɛ
toi kɛ tsinai kɛ bui,
5
And Lot also, which went with
Abram, had flocks, and herds,
and tents."""

res_verse = "5"
ga, eng = test_parse_segment(seg, res_verse)

print(f"GA: {ga}")
print(f"ENG: {eng}")

# Test Case 2: Genesis 13:15 (User's Example)
seg2 = """nyɔŋma kɛ enumɔ
Ga: bo kɛ oshwiei mikɛbaahã kɛaatee naanɔ.
15
English: for all the land which thou seest, to thee will I give it, and to thy seed for ever."""

res_verse2 = "15"
ga2, eng2 = test_parse_segment(seg2, res_verse2)

print("\n--- TEST CASE 2 (Gen 13:15) ---")
print(f"GA: {ga2}")
print(f"ENG: {eng2}")

# Updated dictionary for "nyɔŋma kɛ enumɔ"
num_to_digit_full = {
    "ekome": "1", "enyɔ": "2", "etɛ": "3", "ejwɛ": "4", "enumɔ": "5", 
    "ekpaa": "6", "kpawo": "7", "kpaanyɔ": "8", "neehu": "9", "nyɔŋma": "10",
    "nyɔŋma kɛ ekome": "11", "nyɔŋma kɛ enyɔ": "12", "nyɔŋma kɛ etɛ": "13",
    "nyɔŋma kɛ ejwɛ": "14", "nyɔŋma kɛ enumɔ": "15"
}

def clean_redundancy(text, verse_word):
    # This simulates the logic in indexer.py if we had the full dict
    words = text.split()
    if words:
        # Check if first few words match a entry in the dict
        # In indexer.py we just check the first word for now, 
        # but let's see if we need multi-word cleaning.
        # Actually our indexer.py currently does: 
        # if words and words[0].lower() in num_to_digit: ga_text = " ".join(words[1:])
        pass
    return text

print("Structured Result:")
print(f"GA: {ga2}\nENGLISH: {eng2}")
