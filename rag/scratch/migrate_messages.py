import asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime
import uuid

async def migrate():
    # Configure your MongoDB URI and DB name here
    uri = "mongodb://localhost:27017" # Update if different
    db_name = "heritage-app"
    
    client = AsyncIOMotorClient(uri)
    db = client[db_name]
    
    print(f"Connecting to {db_name}...")
    
    # 1. Fetch all messages
    messages_cursor = db.messages.find().sort("created_at", 1)
    messages = await messages_cursor.to_list(length=None)
    
    print(f"Found {len(messages)} messages to migrate.")
    
    # 2. Group by conversation
    conversations = {}
    for m in messages:
        c_id = m.get("conversation_id")
        if c_id not in conversations:
            conversations[c_id] = []
        conversations[c_id].append(m)
        
    print(f"Total conversations: {len(conversations)}")
    
    # 3. Process into interactions
    all_interactions = []
    for c_id, msgs in conversations.items():
        # Simple pairing logic: assume User then Assistant
        i = 0
        while i < len(msgs):
            m1 = msgs[i]
            role1 = m1.get("role")
            
            if role1 == "user":
                # Look for next assistant message
                query = m1.get("content")
                response = ""
                user_id = m1.get("user_id")
                created_at = m1.get("created_at")
                
                if i + 1 < len(msgs) and msgs[i+1].get("role") == "assistant":
                    response = msgs[i+1].get("content")
                    # Use assistant's timestamp as the definitive one for the turn
                    created_at = msgs[i+1].get("created_at")
                    i += 2
                else:
                    i += 1
                
                all_interactions.append({
                    "id": str(uuid.uuid4()),
                    "conversation_id": c_id,
                    "user_id": user_id,
                    "query": query,
                    "response": response,
                    "metadata": m1.get("metadata", {}),
                    "created_at": created_at
                })
            else:
                # Assistant message without preceding user message? 
                # (unexpected, save it as a turn with empty query)
                all_interactions.append({
                    "id": str(uuid.uuid4()),
                    "conversation_id": c_id,
                    "user_id": m1.get("user_id"),
                    "query": "",
                    "response": m1.get("content"),
                    "metadata": m1.get("metadata", {}),
                    "created_at": m1.get("created_at")
                })
                i += 1

    # 4. Insert into interactions collection
    if all_interactions:
        print(f"Inserting {len(all_interactions)} interactions...")
        await db.interactions.insert_many(all_interactions)
        print("Migration complete!")
    else:
        print("No interactions to save.")
        
    client.close()

if __name__ == "__main__":
    asyncio.run(migrate())
