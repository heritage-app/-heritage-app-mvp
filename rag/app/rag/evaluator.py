"""
Evaluation module for the RAG system using LlamaIndex.
Measures Faithfulness, Relevancy, and specific vocabulary accuracy.
"""

from typing import List, Dict, Any
from llama_index.core.evaluation import FaithfulnessEvaluator, RelevancyEvaluator
from llama_index.core import  QueryBundle
from llama_index.core.schema import NodeWithScore
from llama_index.llms.openrouter import OpenRouter
from app.core.config import settings
import asyncio

class RAGEvaluator:
    def __init__(self):
        # Initialize OpenRouter LLM for evaluation
        self.llm = OpenRouter(
            model=settings.openrouter_model,
            api_key=settings.openrouter_api_key,
            temperature=0.0
        )
        self.faithfulness = FaithfulnessEvaluator(llm=self.llm)
        self.relevancy = RelevancyEvaluator(llm=self.llm)

    async def evaluate_turn(
        self, 
        query: str, 
        response: str, 
        contexts: List[str]
    ) -> Dict[str, Any]:
        """
        Evaluate a single RAG interaction.
        """
        # 1. Faithfulness Check (Hallucination check)
        faith_result = await self.faithfulness.aevaluate(
            query=query,
            response=response,
            contexts=contexts
        )
        
        # 2. Relevancy Check
        rel_result = await self.relevancy.aevaluate(
            query=query,
            response=response,
            contexts=contexts
        )
        
        # 3. Vocabulary Enforcement Check (Heritage Specific)
        vocab_score = 1.0
        vocab_errors = []
        
        # Rule: Naanyo = Friend
        if "friend" in query.lower() or "friend" in response.lower():
            if "naanyo" not in response.lower() and "friend" in response.lower():
                vocab_score -= 0.5
                vocab_errors.append("Missing 'Naanyo' for 'Friend'")
                
        # Rule: Shikpon = Land/Ground/Earth
        if any(w in query.lower() or w in response.lower() for w in ["land", "ground", "earth"]):
            if "shikpon" not in response.lower():
                vocab_score -= 0.5
                vocab_errors.append("Missing 'Shikpon' for Land/Ground/Earth")

        return {
            "faithfulness": faith_result.passing,
            "faithfulness_score": faith_result.score,
            "faithfulness_reason": faith_result.feedback,
            "relevancy": rel_result.passing,
            "relevancy_score": rel_result.score,
            "vocab_score": max(0.0, vocab_score),
            "vocab_errors": vocab_errors
        }

    async def run_benchmark(self, dataset: List[Dict[str, str]]) -> Dict[str, Any]:
        """
        Run evaluation on a full dataset.
        """
        from app.rag.service import ask
        
        results = []
        for item in dataset:
            query = item["query"]
            # We skip the user ID/Conv ID for testing
            full_response = ""
            async for chunk in ask(query, conversation_id=None, user_id="test_runner", stream=True):
                full_response += chunk
            
            # For evaluation, we need to know the context used. 
            # We'll retrieve it manually here for the evaluator.
            from app.rag.retriever import retrieve_context
            nodes = retrieve_context(query)
            contexts = [n.node.text for n in nodes]
            
            eval_data = await self.evaluate_turn(query, full_response, contexts)
            results.append({
                "query": query,
                "response": full_response,
                **eval_data
            })
            
        # Summary metrics
        total = len(results)
        avg_faith = sum(r["faithfulness_score"] for r in results) / total
        avg_rel = sum(r["relevancy_score"] for r in results) / total
        avg_vocab = sum(r["vocab_score"] for r in results) / total
        
        return {
            "summary": {
                "total_tests": total,
                "average_faithfulness": avg_faith,
                "average_relevancy": avg_rel,
                "average_vocab_accuracy": avg_vocab
            },
            "detail": results
        }
