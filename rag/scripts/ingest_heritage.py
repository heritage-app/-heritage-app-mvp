import os
import sys
import argparse
import asyncio
from pathlib import Path

# Add project root to sys.path
sys.path.append(str(Path(__file__).parent.parent))

# Load .env if it exists
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from app.rag.indexer import index_local_document

async def run_ingestion():
    parser = argparse.ArgumentParser(
        description="🌳 Heritage Ingestion Tool: Index your documents into Cloud Qdrant."
    )
    parser.add_argument("--path", type=str, required=True, help="Path to local file or folder")
    parser.add_argument("--category", type=str, required=True, choices=["bible", "story", "history", "dictionary", "general"], help="Heritage category")
    parser.add_argument("--language", type=str, default="ga", help="Primary language of the document (ga, en, etc.)")
    parser.add_argument("--source", type=str, default="Heritage Archive", help="Origin or source of the document")

    args = parser.parse_args()
    
    target_path = Path(args.path)
    if not target_path.exists():
        print(f"❌ Error: Path '{args.path}' does not exist.")
        return

    metadata_base = {
        "category": args.category,
        "language": args.language,
        "source": args.source
    }

    if target_path.is_file():
        print(f"📄 Indexing file: {target_path.name}")
        print(f"   Category: {args.category} | Language: {args.language}")
        await index_local_document(str(target_path), metadata=metadata_base)
        print("✅ Successfully indexed.")

    elif target_path.is_dir():
        supported_extensions = {".pdf", ".txt", ".docx", ".md", ".html", ".json", ".csv"}
        files = [f for f in target_path.rglob("*") if f.suffix.lower() in supported_extensions]
        
        if not files:
            print(f"⚠️ No supported files found in {target_path}")
            return

        print(f"📂 Indexing {len(files)} files from directory: {target_path}")
        print(f"   Category: {args.category} | Language: {args.language}")
        
        for i, file_path in enumerate(files, 1):
            print(f"   [{i}/{len(files)}] Processing: {file_path.name}")
            try:
                await index_local_document(str(file_path), metadata=metadata_base)
            except Exception as e:
                print(f"   ❌ Failed to index {file_path.name}: {e}")
        
        print(f"🏁 Successfully finished indexing {len(files)} items.")

if __name__ == "__main__":
    try:
        asyncio.run(run_ingestion())
    except KeyboardInterrupt:
        print("\n🛑 Ingestion cancelled by user.")
    except Exception as e:
        print(f"\n💥 Unexpected error: {e}")
