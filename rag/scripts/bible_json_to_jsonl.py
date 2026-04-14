import json
import os
import uuid

def convert_bible_json(input_path, output_path):
    """
    Transforms nested Bible chapters into a flat JSONL verse registry.
    """
    print(f"Reading {input_path}...")
    with open(input_path, 'r', encoding='utf-8') as f:
        chapters = json.load(f)

    verse_count = 0
    with open(output_path, 'w', encoding='utf-8') as f:
        for ch in chapters:
            ch_num = ch.get("chapter")
            ch_title_ga = ch.get("ga_title")
            ch_title_en = ch.get("en_title")
            sec_ga = ch.get("section_ga")
            sec_en = ch.get("section_en")

            for v in ch.get("verses", []):
                v_num = v.get("ref")
                ga_text = v.get("ga")
                en_text = v.get("en")
                ga_label = v.get("ga_heading")

                # Construct flat record
                record = {
                    "id": f"bible:genesis:{ch_num}:{v_num}",
                    "category": "bible",
                    "source_name": "genesis ga en bible",
                    "book": "Genesis",
                    "traditional_book": "Mose klɛŋklɛŋ wolo",
                    "chapter_num": ch_num,
                    "chapter_ref": f"Chapter {ch_num}",
                    "chapter_title_ga": ch_title_ga,
                    "chapter_title_en": ch_title_en,
                    "section_ga": sec_ga,
                    "section_en": sec_en,
                    "verse_num": v_num,
                    "verse_ref": f"Genesis {ch_num}:{v_num}",
                    "ga_verse_label": ga_label,
                    "ga": ga_text,
                    "en": en_text,
                }
                
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
                verse_count += 1

    print(f"Successfully converted {verse_count} verses to {output_path}")

if __name__ == "__main__":
    # Use absolute paths based on user environment
    INPUT_FILE = r"c:\Users\pc\Desktop\wqs\docs\genesis_ga_en.json"
    OUTPUT_FILE = r"c:\Users\pc\Desktop\wqs\docs\genesis_ga_en_verses.jsonl"
    
    convert_bible_json(INPUT_FILE, OUTPUT_FILE)
