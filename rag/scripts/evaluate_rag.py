"""
CLI script to run RAG evaluation benchmarks for Nii Obodai.
"""

import asyncio
import os
import sys
import json
from pathlib import Path

# Add project root to path
sys.path.append(str(Path(__file__).parent.parent))

from app.rag.evaluator import RAGEvaluator

# Golden Dataset: Curated heritage questions
GOLDEN_DATASET = [
    {
        "query": "Mose klɛŋklɛŋ wolo",
        "expected_mention": "Genesis",
        "forbid_mention": "Te oyɔɔ tɛŋŋ" # Ensure no check-in
    },
    {
        "query": "Who is Nii Obodai?",
        "expected_mention": "Jamestown",
        "allow_greeting": True
    },
    {
        "query": "What is the Ga word for a friend?",
        "expected_mention": "Naanyo",
        "forbid_mention": "Te oyɔɔ tɛŋŋ"
    },
    {
        "query": "Hɛloo, te oyɔɔ tɛŋŋ?",
        "expected_mention": "jogbaŋŋ",
        "is_greeting": True
    },
    {
        "query": "How do you say 12 in Ga?",
        "expected_mention": "nyɔŋma kɛ enyɔ",
        "forbid_mention": "Te oyɔɔ tɛŋŋ"
    },
    {
        "query": "Translate 133 into Ga",
        "expected_mention": "oha kɛ nyɔŋmai-etɛ kɛ etɛ",
        "forbid_mention": "Te oyɔɔ tɛŋŋ"
    },
    {
        "query": "How do you form 21 in Ga?",
        "expected_mention": "nyɔŋmai-enyɔ kɛ ekome",
        "allow_explanation": True
    },
    {
        "query": "How do I say 'I have 3 books' in Ga?",
        "expected_mention": "woloi etɛ",
        "forbid_mention": "Te oyɔɔ tɛŋŋ"
    },
    {
        "query": "What is the Ga word for 'once'?",
        "expected_mention": "shii kome",
        "forbid_mention": "Te oyɔɔ tɛŋŋ"
    },
    {
        "query": "What is the Ga word for 'second'?",
        "expected_mention": "nɔ ni ji enyɔ",
        "forbid_mention": "Te oyɔɔ tɛŋŋ"
    },
    {
        "query": "Translate 28 into Ga",
        "expected_mention": "nyɔŋmai-enyɔ kɛ kpaanyɔ",
        "forbid_mention": "enyɔ kpaanyɔ"
    },
    {
        "query": "What is 35 in Ga?",
        "expected_mention": "nyɔŋmai-etɛ kɛ enumɔ",
        "forbid_mention": "etɛ enumɔ"
    },
    {
        "query": "How do you say 28 books in Ga?",
        "expected_mention": "woloi nyɔŋmai-enyɔ kɛ kpaanyɔ",
        "forbid_mention": "woloi enyɔ kpaanyɔ"
    }
]

async def run_evaluation():
    print("🚀 Starting Nii Obodai RAG Evaluation (v6 - Straight Answer Mode)...")
    print(f"📊 Dataset Size: {len(GOLDEN_DATASET)} queries")
    print("-" * 50)
    
    evaluator = RAGEvaluator()
    results = await evaluator.run_benchmark(GOLDEN_DATASET)
    
    # Custom rule check for 'Straight Answers'
    for r in results["detail"]:
        q_item = next((item for item in GOLDEN_DATASET if item["query"] == r["query"]), None)
        if q_item and q_item.get("forbid_mention"):
            if q_item["forbid_mention"].lower() in r["response"].lower():
                r["vocab_errors"].append(f"Unsolicited phrase detected: '{q_item['forbid_mention']}'")
                r["vocab_score"] = 0.0
    
    # Print Summary
    summary = results["summary"]
    print("\n📈 EVALUATION SUMMARY")
    print(f"Pass/Fail Faithfulness: {summary['average_faithfulness']:.2%}")
    print(f"Relevancy Score:        {summary['average_relevancy']:.2%}")
    print(f"Vocabulary Accuracy:   {summary['average_vocab_accuracy']:.2%}")
    print("-" * 50)
    
    # Print Details
    print("\n🔍 DETAILED RESULTS")
    for r in results["detail"]:
        status = "✅" if r["faithfulness"] and r["relevancy"] else "⚠️"
        print(f"\n{status} Q: {r['query']}")
        print(f"   A: {r['response'][:100]}...")
        if r["vocab_errors"]:
            print(f"   Vocab Errors: {', '.join(r['vocab_errors'])}")
        print(f"   Faithfulness: {r['faithfulness_score']} | Relevancy: {r['relevancy_score']}")

    # Save to file
    output_path = Path("rag_eval_report.json")
    with open(output_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\n💾 Full report saved to {output_path.absolute()}")

if __name__ == "__main__":
    asyncio.run(run_evaluation())
