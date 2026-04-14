import sys
from pathlib import Path

# Add project root to sys.path
sys.path.append(str(Path(__file__).parent.parent))

from app.rag.validator import validate_bible_quote_output, rebuild_bible_output, VerseValidationError

# Mock metadata for Genesis 20:1
mock_meta = {
    "category": "bible",
    "book": "Genesis",
    "chapter_num": 20,
    "verse_num": 1,
    "verse_ref": "Genesis 20:1",
    "reference_display": "Mose klɛŋklɛŋ wolo, Yitso Nyɔŋmai Enyɔ, Kuku ni ji ekome (Genesis 20:1)",
    "ga": "Abraham fã yɛ he ni eyɔɔ lɛ kɛtee wuoyigbɛ shikpɔŋ lɛ nɔ. Eyahi Kadesh kɛ Shur teŋ, ni eyato gbɔ yɛ Gerar.",
    "en": "And Abraham journeyed from thence toward the south country, and dwelled between Kadesh and Shur, and sojourned in Gerar.",
    "source_name": "genesis ga en verses",
    "ga_version_name": "Ŋmalɛ Krɔŋkrɔŋ Lɛ",
    "ga_version_abbr": "NEGAB",
    "english_version_name": "King James Version",
    "english_version_abbr": "KJV"
}

print("--- TESTING REBUILD ---")
rebuilt = rebuild_bible_output(mock_meta)
print(rebuilt)

print("\n--- TESTING VALIDATION (SUCCESS) ---")
try:
    validated = validate_bible_quote_output(rebuilt, mock_meta)
    print("SUCCESS: Output was validated correctly.")
except VerseValidationError as e:
    print(f"FAILURE: {e}")

print("\n--- TESTING VALIDATION (FAILURE - MISSING FIRST LINE) ---")
bad_output = rebuilt.split("\n", 1)[1] # Remove the first line
try:
    validate_bible_quote_output(bad_output, mock_meta)
except VerseValidationError as e:
    print(f"CAUGHT EXPECTED ERROR: {e}")

print("\n--- TESTING VALIDATION (FAILURE - WRONG SOURCE) ---")
bad_output = rebuilt.replace("genesis ga en verses", "Genesis 20:1")
try:
    validate_bible_quote_output(bad_output, mock_meta)
except VerseValidationError as e:
    print(f"CAUGHT EXPECTED ERROR: {e}")
