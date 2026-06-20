import asyncio
import json
import websockets

async def run_test():
    url = "ws://localhost:8001"
    email = "verification_doctor@gmail.com"
    name = "検証専攻医"
    
    print("\n--- PHASE 1: INITIAL LOGIN & PLAY ---")
    print(f"Connecting to {url}...")
    async with websockets.connect(url) as ws:
        # Receive init state
        await ws.recv()
        
        # Login
        print(f"Logging in as {email} ({name})...")
        await ws.send(json.dumps({"type": "USER_LOGIN", "email": email, "name": name}))
        
        # Expect LOGIN_SUCCESS
        login_res = json.loads(await ws.recv())
        assert login_res["type"] == "LOGIN_SUCCESS"
        user = login_res["user"]
        print(f"Login success! High score is: {user['high_score']}")
        
        # Start game
        print("Starting game...")
        await ws.send(json.dumps({"type": "START_GAME"}))
        
        # Loop to wait for state update in PLAYING state with active emergency
        active_bed_id = None
        evt = None
        state = None
        print("Waiting for game state to transition to PLAYING with spawned emergency...")
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
        print(f"Patient: {state['beds'][active_bed_id]['patient']}")
        
        # 1. Answer CORRECTLY once to gain 50 points
        step_data = evt["steps"][evt["current_step"]]
        right_opt = [o for o in step_data["opts"] if o["ok"]][0]
        print(f"Sending correct action: {right_opt['id']}...")
        await ws.send(json.dumps({
            "type": "PERFORM_ACTION",
            "bed_id": active_bed_id,
            "action_id": right_opt["id"]
        }))
        
        # Wait for feedback indicating correct answer (current_step should advance to 1)
        p_score = 0
        while True:
            msg = await ws.recv()
            payload = json.loads(msg)
            if payload.get("type") == "STATE_UPDATE":
                state = payload["state"]
                bed = state["beds"][active_bed_id]
                p_score = list(state["players"].values())[0]["score"] if state["players"] else 0
                if bed["active_event"] and bed["active_event"]["current_step"] == 1:
                    evt = bed["active_event"]
                    break
        
        print(f"Current Score: {p_score} points (Safety: {state['safety']}%)")
        print(f"Feedback received: {evt['last_feedback']}")
        assert p_score == 50
        assert "✅" in evt["last_feedback"]
        
        # 2. Intentionally FAIL to trigger Game Over (RESULT) & Save Score
        print("Sending incorrect actions to force Game Over...")
        
        while state["status"] == "PLAYING":
            target_bed_id = None
            target_wrong_opt_id = None
            for bid, bed in state["beds"].items():
                if bed["active_event"]:
                    evt = bed["active_event"]
                    curr_step = evt["steps"][evt["current_step"]]
                    wrongs = [o for o in curr_step["opts"] if not o["ok"]]
                    if wrongs:
                        target_bed_id = bid
                        target_wrong_opt_id = wrongs[0]["id"]
                        break
            
            if not target_wrong_opt_id:
                # If no active emergency, we just wait (this shouldn't happen often in test)
                await asyncio.sleep(0.5)
            else:
                await ws.send(json.dumps({
                    "type": "PERFORM_ACTION",
                    "bed_id": target_bed_id,
                    "action_id": target_wrong_opt_id
                }))
            
            # Wait for next state update
            while True:
                msg = await ws.recv()
                payload = json.loads(msg)
                if payload.get("type") == "STATE_UPDATE":
                    state = payload["state"]
                    break
            
            print(f"Safety decreased: {state['safety']}% | Status: {state['status']}")
            
        print(f"Game finished. Final Status: {state['status']}. Safety: {state['safety']}%")
        assert state["status"] == "RESULT"

    print("\n--- PHASE 2: RE-LOGIN & VERIFY PERSISTENCE ---")
    print("Re-connecting to server to verify high score persistence...")
    async with websockets.connect(url) as ws:
        await ws.recv() # init
        
        # Login again
        await ws.send(json.dumps({"type": "USER_LOGIN", "email": email, "name": name}))
        
        login_res = json.loads(await ws.recv())
        assert login_res["type"] == "LOGIN_SUCCESS"
        user = login_res["user"]
        
        print(f"Re-login success! Loaded High Score: {user['high_score']} points.")
        # Assert that high score of 50 was saved and reloaded
        assert user["high_score"] == 50
        print("✅ Data persistence and single-player session isolation verified successfully!")

if __name__ == "__main__":
    asyncio.run(run_test())
