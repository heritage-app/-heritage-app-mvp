import asyncio
from app.rag.prompts import STRICT_GUARDRAIL_PROMPT
from app.rag.llm import get_llm
from langchain_core.prompts import ChatPromptTemplate

async def test_ga_scripture_citation():
    # Simulated retrieved context with the new schema columns
    context_text = """
[Source: [Genesis](BIBLE1_1_1.pdf) | Score: 0.999]
{
    "verse_id": "MOSE1_1_1",
    "eng_ref": "Genesis 1:1",
    "eng_text": "In the beginning God created the heaven and the earth.",
    "ga_book_title": "Mose klɛŋklɛŋ wolo",
    "ga_ch_title": "Yitso Ekome",
    "ga_v_heading": "Kuku ni ji ekome",
    "ga_text": "Shishijee mli lɛ Nyɔŋmɔ bɔ ŋwɛi kɛ shikpɔŋ lɛ."
}
"""

    query = "How is Genesis 1:1 cited in Ga, and what is the text?"
    
    guardrail_template = ChatPromptTemplate.from_messages([
        ("system", STRICT_GUARDRAIL_PROMPT),
        ("human", "{query}")
    ])
    
    # We use a non-streaming LLM for verification
    llm = get_llm(temperature=0.0, streaming=False)
    chain = guardrail_template | llm
    
    print(f"Query: {query}")
    print("---")
    
    try:
        response = await chain.ainvoke({
            "query": query,
            "context_text": context_text
        })
        print(f"Response:\n{response.content}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_ga_scripture_citation())
