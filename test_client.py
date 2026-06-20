import asyncio
import json
import websockets

async def run_test():
    url = "ws://localhost:8001"
    print(f"Connecting to {url}...")
    async with websockets.connect(url) as ws:
        # 1. Receive initial state
        initial_msg = await ws.recv()
        state = json.loads(initial_msg)["state"]
        print("Successfully connected and received initial state.")
        assert state["status"] in ["LOBBY", "PLAYING", "RESULT"]
        
        # 2. Join Game
        print("Joining game as 'テスト専攻医'...")
        await ws.send(json.dumps({"type": "JOIN_GAME", "name": "テスト専攻医"}))
        
        # Wait for state update after join
        msg = await ws.recv()
        state = json.loads(msg)["state"]
        print(f"Joined players: {[p['name'] for p in state['players'].values()]}")
        
        # 3. Start Game
        print("Starting the game shift...")
        await ws.send(json.dumps({"type": "START_GAME"}))
        
        # Wait for game start broadcast
        msg = await ws.recv()
        state = json.loads(msg)["state"]
        assert state["status"] == "PLAYING"
        print("Game status successfully changed to PLAYING.")
        
        # Find active emergency bed
        active_bed_id = None
        active_evt = None
        for bid, bed in state["beds"].items():
            if bed["active_event"]:
                active_bed_id = bid
                active_evt = bed["active_event"]
                break
                
        if not active_bed_id:
            print("No initial emergency spawned, waiting for next broadcast...")
            msg = await ws.recv()
            state = json.loads(msg)["state"]
            for bid, bed in state["beds"].items():
                if bed["active_event"]:
                    active_bed_id = bid
                    active_evt = bed["active_event"]
                    break
                    
        assert active_bed_id is not None
        print(f"🚨 Emergency spawned at bed {active_bed_id}: {active_evt['title']}")
        print(f"Patient: {state['beds'][active_bed_id]['patient']}")
        
        step_data = active_evt["steps"][active_evt["current_step"]]
        print(f"Question: {step_data['q']}")
        print("Options:")
        for o in step_data["opts"]:
            print(f" - {o['id']}: {o['text']} (ok: {o['ok']})")
            
        # 4. Perform INCORRECT action
        wrong_opt = [o for o in step_data["opts"] if not o["ok"]][0]
        print(f"Sending INCORRECT option: {wrong_opt['id']} ({wrong_opt['text']})...")
        await ws.send(json.dumps({
            "type": "PERFORM_ACTION",
            "bed_id": active_bed_id,
            "action_id": wrong_opt["id"]
        }))
        
        msg = await ws.recv()
        state = json.loads(msg)["state"]
        updated_evt = state["beds"][active_bed_id]["active_event"]
        
        print(f"Safety score after incorrect action: {state['safety']}%")
        print(f"Feedback received: {updated_evt['last_feedback']}")
        assert state["safety"] < 100
        assert "❌" in updated_evt["last_feedback"]
        assert updated_evt["current_step"] == 0  # Should NOT advance step
        
        # 5. Perform CORRECT action
        right_opt = [o for o in step_data["opts"] if o["ok"]][0]
        print(f"Sending CORRECT option: {right_opt['id']} ({right_opt['text']})...")
        await ws.send(json.dumps({
            "type": "PERFORM_ACTION",
            "bed_id": active_bed_id,
            "action_id": right_opt["id"]
        }))
        
        msg = await ws.recv()
        state = json.loads(msg)["state"]
        updated_evt = state["beds"][active_bed_id]["active_event"]
        
        print(f"Feedback received: {updated_evt['last_feedback']}")
        assert "✅" in updated_evt["last_feedback"]
        assert updated_evt["current_step"] == 1  # Should ADVANCE step
        print("Verification successful!")

if __name__ == "__main__":
    asyncio.run(run_test())
