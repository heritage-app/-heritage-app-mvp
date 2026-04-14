import asyncio
from app.rag.discovery import list_chapters, list_verses

async def test():
    print("Testing Discovery Labels for Genesis...")
    chapters = list_chapters("Genesis")
    print(f"Total Chapters: {len(chapters)}")
    
    # Check Chapter 12 specifically (user's example)
    if 12 in chapters:
        print(f"Chapter 12 Title: {chapters[12]}")
    else:
        print("Chapter 12 not found!")
        
    print("\nTesting Verses for Chapter 12...")
    verses = list_verses("Genesis", 12)
    print(f"Total Verses: {len(verses)}")
    if 13 in verses:
        print(f"Verse 13 Label: {verses[13]}")

if __name__ == "__main__":
    asyncio.run(test())
