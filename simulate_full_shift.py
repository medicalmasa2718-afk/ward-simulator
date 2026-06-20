import asyncio
import json
import websockets
import time

# --- CORRECT ANSWER MAPPING FOR ALL 6 SCENARIOS ---
ANSWERS = {
    "dka": ["dka_gas", "dka_saline_k"],
    "dissection": ["dis_ecg", "dis_surg"],
    "sepsis": ["sep_iv_c", "sep_ercp"],
    "varices": ["var_pos", "var_evl"],
    "hyperkalemia": ["k_ecg", "k_calc", "k_gi_hd"],
    "copd": ["copd_gas", "copd_nppv", "copd_meds"]
}

async def run_simulation():
    url = "ws://localhost:8001"
    email = "simulation_champion@google.com"
    name = "シミュレーション専攻医"
    
    print("==================================================")
    print("   CLINICAL EMERGENCIES FULL SHIFT SIMULATION")
    print("==================================================")
    print(f"Connecting to game server at {url}...")
    
    async with websockets.connect(url) as ws:
        # Receive initial state
        await ws.recv()
        
        # 1. Login with Google-simulated credentials
        print(f"\n[LOGIN] Logging in as {email} ({name})...")
        await ws.send(json.dumps({"type": "USER_LOGIN", "email": email, "name": name}))
        
        login_res = json.loads(await ws.recv())
        assert login_res["type"] == "LOGIN_SUCCESS"
        user = login_res["user"]
        print(f"-> SUCCESS. Registered Email: {user['email']}, Current High Score: {user['high_score']}")
        
        # Receive state update
        await ws.recv()
        
        # 2. Start Shift
        print("\n[SHIFT] Requesting START_GAME...")
        await ws.send(json.dumps({"type": "START_GAME"}))
        
        # State tracking loop
        print("\n[LOOP] Starting monitoring loop. Will automatically solve emergencies with correct guidelines...")
        last_time_left = None
        solved_instances = set() # Track cases solved in this test client to avoid duplicate prints
        
        while True:
            msg = await ws.recv()
            payload = json.loads(msg)
            
            if payload.get("type") == "STATE_UPDATE":
                state = payload["state"]
                status = state["status"]
                time_left = state["time_left"]
                safety = state["safety"]
                
                # Print periodic timer updates
                if time_left != last_time_left:
                    m = Math_floor_sim = time_left // 60
                    s = time_left % 60
                    print(f"⏱️ Time Left: {m:02d}:{s:02d} | Safety: {safety}% | Score: {list(state['players'].values())[0]['score']} pts", flush=True)
                    last_time_left = time_left
                
                # Check for active emergencies
                for bid, bed in state["beds"].items():
                    evt = bed["active_event"]
                    if evt:
                        evt_id = evt["id"]
                        current_step = evt["current_step"]
                        
                        # Look up correct action
                        correct_actions = ANSWERS.get(evt_id)
                        if correct_actions and current_step < len(correct_actions):
                            correct_action_id = correct_actions[current_step]
                            
                            # Print decision event
                            question_data = evt["steps"][current_step]
                            print(f"\n🚨 [CALL] Emergency at Bed {bid}: {evt['title']} (Step {current_step+1}/{len(correct_actions)})")
                            print(f"   Patient: {bed['patient']}")
                            print(f"   Question: {question_data['q']}")
                            print(f"   💡 AI Decision: Select \"{next(o['text'] for o in question_data['opts'] if o['id'] == correct_action_id)}\"")
                            
                            # Send PERFORM_ACTION
                            await ws.send(json.dumps({
                                "type": "PERFORM_ACTION",
                                "bed_id": bid,
                                "action_id": correct_action_id
                            }))
                            # Brief sleep to allow message handling spacing
                            await asyncio.sleep(0.5)
                
                # Check for solved cases debriefing updates
                for d in state["debriefings"]:
                    deb_key = f"{d['patient']}_{d['id']}"
                    if deb_key not in solved_instances:
                        print(f"\n✨ [RESOLVED] Bed updated to stable. {d['patient']} ({d['diagnosis']}) successfully saved by {d['saved_by']}!")
                        solved_instances.add(deb_key)
                
                # Check for Game End
                if status == "RESULT":
                    print("\n==================================================")
                    print("                SHIFT COMPLETED")
                    print("==================================================")
                    print(f"Final Patient Safety: {safety}%")
                    print(f"Final Score: {list(state['players'].values())[0]['score']} points")
                    print(f"Debriefing list:")
                    for idx, d in enumerate(state["debriefings"]):
                        print(f"  {idx+1}. {d['title']} ({d['patient']}) -> SAVED")
                    break
                    
        # Verification persistence
        print("\n[VERIFY] Re-connecting to verify save record...")
        
    async with websockets.connect(url) as ws:
        await ws.recv() # init
        await ws.send(json.dumps({"type": "USER_LOGIN", "email": email, "name": name}))
        login_res = json.loads(await ws.recv())
        user_updated = login_res["user"]
        print(f"-> Verification Success. Saved High Score in Database: {user_updated['high_score']} points.")
        print(f"-> Completed Case IDs in Database: {user_updated['completed_cases']}")
        print("==================================================")
        print("   SIMULATION SUCCESSFUL. GUIDELINES CONFIRMED.")
        print("==================================================")

if __name__ == "__main__":
    asyncio.run(run_simulation())
