import sys
from pathlib import Path

# Add project root to path
sys.path.append(str(Path(__file__).parent.parent))

from app.rag.vector_store import get_vector_store
from app.rag.constants import COLLECTION_MAP

def init_indexes():
    print("Initializing payload indexes for all collections...")
    collections = ["bibele_documents", "heritage_documents"]
    for col in collections:
        print(f"Checking {col}...")
        get_vector_store(col)
    print("Done.")

if __name__ == "__main__":
    init_indexes()
