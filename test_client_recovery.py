import asyncio
import json
import websockets

async def run_test():
    url = "ws://localhost:8001"
    email = "recovery_test@google.com"
    name = "回復検証専攻医"
    
    print(f"Connecting to game server at {url}...")
    async with websockets.connect(url) as ws:
        await ws.recv() # init state
        
        # Login
        print(f"Logging in as {email}...")
        await ws.send(json.dumps({"type": "USER_LOGIN", "email": email, "name": name}))
        login_res = json.loads(await ws.recv())
        assert login_res["type"] == "LOGIN_SUCCESS"
        
        # Start Game
        print("Starting game...")
        await ws.send(json.dumps({"type": "START_GAME"}))
        
        # Wait for state update (PLAYING with active emergency)
        active_bed_id = None
        evt = None
        state = None
        print("Waiting for emergency spawn (configured for 35s spawn timer initially)...")
        
        # In this test, let's keep reading state updates until an event is active
        while True:
            msg = await ws.recv()
            payload = json.loads(msg)
            if payload.get("type") == "STATE_UPDATE":
                state = payload["state"]
                if state["status"] == "PLAYING":
                    for bid, bed in state["beds"].items():
                        if bed["active_event"]:
                            active_bed_id = bid
                            evt = bed["active_event"]
                            break
                    if active_bed_id:
                        break
        
        print(f"🚨 Emergency spawned at bed {active_bed_id}: {evt['title']}")
        
        # 1. Answer INCORRECTLY (Normal error)
        step_data = evt["steps"][evt["current_step"]]
        wrong_opt = [o for o in step_data["opts"] if not o["ok"]][0]
        
        print(f"Sending INCORRECT action: {wrong_opt['id']}...")
        await ws.send(json.dumps({
            "type": "PERFORM_ACTION",
            "bed_id": active_bed_id,
            "action_id": wrong_opt["id"]
        }))
        
        # Wait for penalty update
        while True:
            msg = await ws.recv()
            payload = json.loads(msg)
            if payload.get("type") == "STATE_UPDATE":
                state = payload["state"]
                # We expect safety to drop by exactly 7% (from 100% to 93%)
                if state["safety"] < 100:
                    break
        
        print(f"Safety score after incorrect action: {state['safety']}%")
        # Assert penalty is relaxed to 7% (from 12%)
        assert state["safety"] == 93
        print("✅ Relaxed incorrect action penalty (-7%) verified successfully.")
        
        # 2. Answer CORRECTLY and check safety RECOVERY (+8%)
        right_opt = [o for o in step_data["opts"] if o["ok"]][0]
        print(f"Sending CORRECT action: {right_opt['id']}...")
        await ws.send(json.dumps({
            "type": "PERFORM_ACTION",
            "bed_id": active_bed_id,
            "action_id": right_opt["id"]
        }))
        
        # Wait for recovery update (should increase safety from 93% + 8% = 100%クランプ)
        while True:
            msg = await ws.recv()
            payload = json.loads(msg)
            if payload.get("type") == "STATE_UPDATE":
                state = payload["state"]
                # Look for safety recovery
                if state["safety"] > 93:
                    break
        
        print(f"Safety score after correct action: {state['safety']}%")
        # Assert safety recovered back to 100%
        assert state["safety"] == 100
        print("✅ Safety recovery system (+8% for correct answers) verified successfully.")
        print("==================================================")
        print("      ALL GAUGE SYSTEMS VERIFIED SUCCESSFULLY.")
        print("==================================================")

if __name__ == "__main__":
    asyncio.run(run_test())
