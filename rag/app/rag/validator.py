import re
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

class VerseValidationError(Exception):
    """Custom exception for Bible archival integrity failures."""
    pass


def is_retrievable_bible_record(metadata: Dict[str, Any]) -> bool:
    """
    Minimal retrieval-time validator.
    Only rejects obvious garbage so the semantic retrieval can still see candidates.
    """
    ga = (metadata.get("ga") or "").strip()
    en = (metadata.get("en") or "").strip()

    bad_markers = [
        "Bible in Ga Language",
        "© Bible Society of Ghana",
        "Currently Selected",
        "Learn More",
        "Rights in the",
    ]

    if any(marker.lower() in ga.lower() for marker in bad_markers):
        return False
    if any(marker.lower() in en.lower() for marker in bad_markers):
        return False

    # allow records that have at least one real side present
    return bool(ga or en)


def is_formattable_bible_record(metadata: Dict[str, Any]) -> bool:
    """
    Strict quote-time validator.
    Only passes records that have all necessary fields to format a perfect quote block.
    """
    required = [
        "reference_display",
        "ga_version_name",
        "ga_version_abbr",
        "english_version_name",
        "english_version_abbr",
        "ga",
        "en",
        "source_name",
    ]
    return all(bool((metadata.get(k) or "").strip()) for k in required)


def format_bible_quote(metadata: Dict[str, Any]) -> str:
    """
    Deterministically formats a validated Bible quote.
    Bypasses the LLM entirely to guarantee 100% template fidelity.
    """
    from app.rag.indexer import BibleRefiner
    
    # DYNAMIC RECONSTRUCTION: If reference_display is missing, build it using BibleRefiner logic
    ref = metadata.get("reference_display")
    if not ref:
        book = metadata.get("book", "Genesis")
        trad_book = metadata.get("traditional_book") or BibleRefiner.get_trad_book(book)
        
        ch_num = int(metadata.get("chapter_num", 0))
        ga_ch = metadata.get("chapter_title_ga") or BibleRefiner.get_ga_chapter_title(ch_num)
        
        v_num = int(metadata.get("verse_num", 0))
        ga_v = metadata.get("ga_label") or BibleRefiner.get_ga_label(v_num)
        
        v_ref = metadata.get("verse_ref") or f"{book} {ch_num}:{v_num}"
        ref = f"{trad_book}, {ga_ch}, {ga_v} ({v_ref})"
    
    ga_name = metadata.get("ga_version_name") or "Ŋmalɛ Krɔŋkrɔŋ Lɛ"
    ga_abbr = metadata.get("ga_version_abbr") or "NEGAB"
    ga_text = metadata.get("ga", "").strip()
    
    en_name = metadata.get("english_version_name") or "King James Version"
    en_abbr = metadata.get("english_version_abbr") or "KJV"
    en_text = metadata.get("en", "").strip()
    
    # Ensure source_name is the filename and strip extension for archival cleanliness
    source = metadata.get("source_name") or metadata.get("filename") or "Bible Archive"
    if "." in source:
        source = ".".join(source.split(".")[:-1])
    source = source.replace("_", " ").strip()

    # Strict multi-line format with identical spacing/labels
    return (
        f"{ref}\n"
        f"Ga Version: {ga_name} ({ga_abbr}):\n"
        f"{ga_text}\n\n"
        f"English Version: {en_name} ({en_abbr}):\n"
        f"{en_text}\n\n"
        f"Source: {source}"
    )
