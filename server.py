import asyncio
import json
import http.server
import socketserver
import threading
import os
import random
import time
import urllib.request
import urllib.parse

# --- CONSTANTS ---
HTTP_PORT = 8000
WS_PORT = 8001
GAME_DURATION = 180  # 3 minutes in seconds
MAX_SAFETY = 100

DB_FILE = os.path.join(os.path.dirname(__file__), "users_db.json")

# --- USER PERSISTENCE DATABASE ---
users_db = {}

def load_db():
    global users_db
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, "r", encoding="utf-8") as f:
                users_db = json.load(f)
            print(f"Database loaded: {len(users_db)} users.", flush=True)
        except Exception as e:
            print(f"Error loading database: {e}", flush=True)
            users_db = {}
    else:
        users_db = {}
        save_db()

def save_db():
    try:
        with open(DB_FILE, "w", encoding="utf-8") as f:
            json.dump(users_db, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Error saving database: {e}", flush=True)

load_db()

# --- CLINICAL CASES ---
CLINICAL_CASES = [
    {
        "id": "dka",
        "title": "糖尿病性ケトアシドーシス (DKA)",
        "patient": "24歳女性 (1型糖尿病既往)",
        "diagnosis": "糖尿病性ケトアシドーシス (DKA)",
        "status": "warning",
        "vitals": {"hr": 112, "bp_sys": 102, "bp_dia": 64, "spo2": 98},
        "description": "シックデイでインスリン自己中断後。悪心・嘔吐と倦怠感を訴え、呼吸が非常に荒いです。",
        "steps": [
            {
                "q": "シックデイでインスリン自己中断後。悪心・嘔吐と倦怠感で受診。まず行うべき検査は？",
                "opts": [
                    {"id": "dka_gas", "text": "静脈血ガス、生化学、尿ケトン体検査", "ok": True, "fb": "pH 7.15, HCO3- 10, 尿ケトン3+を確認。DKAの診断基準を満たし、治療方針が決定できます。"},
                    {"id": "dka_ct", "text": "緊急腹部単純CT検査", "ok": False, "fb": "急性腹症を疑うのも分かりますが、まずは酸塩基平衡と高血糖の評価が最優先です。CT室への移動で時間が無駄になります。"},
                    {"id": "dka_ins", "text": "インスリン10単位を直ちに静脈注射", "ok": False, "critical": True, "fb": "カリウム値が未確認の状態でインスリンを投与すると、重篤な低カリウム血症を誘発し心停止を招く危険があります。禁忌です！"},
                    {"id": "dka_egd", "text": "上部消化管内視鏡検査 (胃カメラ)", "ok": False, "fb": "この全身状態でいきなり胃カメラを行うのは極めて危険であり、適応もありません。"}
                ]
            },
            {
                "q": "pH 7.15, K 3.1 mEq/L と判明しました。初期治療として最も適切なのは？",
                "opts": [
                    {"id": "dka_saline_k", "text": "生理食塩水大量輸液を開始し、カリウムを補充しながらインスリン持続静注を検討する", "ok": True, "fb": "大正解！DKA治療の基本は大量輸液です。またK < 3.3ではインスリンを単独で開始せず、まずカリウム補充を先行・併用します。"},
                    {"id": "dka_ins_only", "text": "生理食塩水 50mL/hで点滴し、速効型インスリン持続静注を開始", "ok": False, "fb": "脱水が重度（通常5-10Lの欠乏）のため、50mL/hでは少なすぎます。またK 3.1の状態でカリウム補充なしのインスリン開始は致死性不整脈のリスクを高めます。"},
                    {"id": "dka_glu", "text": "5%ブドウ糖液 1000mL を1時間で急速点滴", "ok": False, "fb": "血糖値がまだ450mg/dLと高値の間はブドウ糖液の投与は行いません。血糖が250-300mg/dL以下に低下してからブドウ糖液に切り替えます。"},
                    {"id": "dka_prim", "text": "悪心に対してプリンペラン静注のみで経過観察", "ok": False, "fb": "DKAの本態はインスリン欠乏によるケトーシスと脱水です。対症療法だけで放置すると昏睡・死亡します。"}
                ]
            }
        ]
    },
    {
        "id": "dissection",
        "title": "急性大動脈解離 (Stanford A型)",
        "patient": "65歳男性 (高血圧放置)",
        "diagnosis": "急性大動脈解離 (Stanford A型)",
        "status": "warning",
        "vitals": {"hr": 96, "bp_sys": 172, "bp_dia": 95, "spo2": 96},
        "description": "突然の引き裂かれるような背部痛で搬送。右腕と左腕で血圧に大きな左右差があります。",
        "steps": [
            {
                "q": "突然の引き裂かれるような背部痛で搬送。右腕と左腕で血圧に大きな左右差があります。最初に行う対応は？",
                "opts": [
                    {"id": "dis_ecg", "text": "12誘導心電図検査と胸部単純X線撮影", "ok": True, "fb": "心電図で心筋梗塞を除外しつつ、胸部X線で縦隔陰影の拡大を確認します。左右の血圧差がある胸痛は急性大動脈解離を強く疑います。"},
                    {"id": "dis_nitro", "text": "心筋梗塞を疑い、直ちにニトロペン舌下投与", "ok": False, "critical": True, "fb": "大動脈解離で不用意にニトロペンを投与すると、過度な降圧からショックや解離の進展を招く危険があり危険です。"},
                    {"id": "dis_lox", "text": "鎮痛薬(ロキソニン)を処方して様子見", "ok": False, "critical": True, "fb": "見逃せば即死し得る超緊急疾患です。鎮痛だけで経過を見るのは絶対にあり得ません！"},
                    {"id": "dis_hep", "text": "直ちに抗凝固療法(ヘパリン静注)を開始", "ok": False, "critical": True, "fb": "大動脈解離に対して抗凝固療法を行うと、心タンポナーデや大出血を誘発し致命的となります。禁忌です！"}
                ]
            },
            {
                "q": "造影CTで上行大動脈に偽腔を認め、Stanford A型大動脈解離と診断。最終治療方針は？",
                "opts": [
                    {"id": "dis_surg", "text": "心臓血管外科へ緊急コールし、緊急手術を依頼する", "ok": True, "fb": "大正解！Stanford A型（上行大動脈に解離あり）は発症から1時間毎に死亡率が1-2%上昇するため、緊急人工血管置換術の適応です。"},
                    {"id": "dis_med", "text": "ニカルジピン持続静注で降圧し、一般病棟で厳重安静・保存的治療", "ok": False, "fb": "Stanford B型（上行大動脈に解離なし）であれば保存的治療が第一選択ですが、A型は内科的管理だけでは救命困難です。"},
                    {"id": "dis_cath", "text": "循環器内科コールし、緊急心臓カテーテル検査を依頼", "ok": False, "critical": True, "fb": "大動脈解離の偽腔にカテーテルを挿入すると大動脈破裂を引き起こすリスクが非常に高いため禁忌です！"}
                ]
            }
        ]
    },
    {
        "id": "sepsis",
        "title": "重症急性胆管炎 (敗血症ショック)",
        "patient": "78歳女性 (総胆管結石既往)",
        "diagnosis": "重症急性胆管炎 (敗血症ショック)",
        "status": "danger",
        "vitals": {"hr": 122, "bp_sys": 82, "bp_dia": 48, "spo2": 92},
        "description": "病棟で高熱と悪寒戦慄、血圧低下、黄疸が出現。急性胆管炎による敗血症ショックが疑われます。",
        "steps": [
            {
                "q": "病棟で高熱と悪寒戦慄、血圧低下、黄疸が出現。急性胆管炎による敗血症ショックが疑われます。まず行うべきセットは？",
                "opts": [
                    {"id": "sep_iv_c", "text": "ルート確保し細胞外液を急速輸液、血液培養2セット採取、腹部エコーを行う", "ok": True, "fb": "正解！敗血症ショックにおける初期対応の基本です。迅速な大量輸液と、抗菌薬開始前の血液培養採取、エコーでの胆道系評価を行います。"},
                    {"id": "sep_acet", "text": "解熱薬（アセトアミノフェン）を静注し、熱が下がるまで経過観察", "ok": False, "fb": "敗血症ショックは進行が非常に早く、単なる解熱対応だけでは多臓器不全に至り死亡します。"},
                    {"id": "sep_ng", "text": "胃管（NGチューブ）を挿入して胃液減圧を行う", "ok": False, "fb": "胆管炎の初期治療として胃管挿入の優先度は低く、血圧低下に対するショック対応が先です。"},
                    {"id": "sep_nor_only", "text": "降圧薬を中止し、昇圧薬（ノルアドレナリン）を直ちに単独で開始する", "ok": False, "fb": "十分な輸液負荷（30mL/kg）を行う前に昇圧薬を単独で使用するのは末梢血管を過剰収縮させ心負荷や虚血を招き危険です。"}
                ]
            },
            {
                "q": "エコーで総胆管結石を視認。十分な輸液でも血圧 85/50 と低値。根本治療と血圧維持のための次の一手は？",
                "opts": [
                    {"id": "sep_ercp", "text": "広域抗菌薬開始、消化器内科に緊急内視鏡ドレナージ(ERCP)依頼、ノルアドレナリン持続静注開始", "ok": True, "fb": "完璧です！重症急性胆管炎は緊急ドレナージ（ERCPによる胆道減圧）を行わないと救命できません。抗菌薬とノルアドレナリンによる循環維持を併行します。"},
                    {"id": "sep_surg", "text": "外科に緊急開腹手術（胆嚢摘出・胆管切開）を依頼する", "ok": False, "fb": "敗血症ショックの急性期に全身麻酔での緊急開腹手術を行うのは、侵襲が大きすぎて患者が耐えられません。内視鏡的ドレナージが低侵襲で第一選択です。"},
                    {"id": "sep_dop", "text": "ドパミンを最大量で持続静注し、血圧が110を超えるまで輸液を続ける", "ok": False, "fb": "敗血症ショックに対する第一選択の昇圧薬はノルアドレナリンです。ドパミンは致死性不整脈リスクが高ため推奨されません。また過剰な輸液は心負荷となります。"}
                ]
            }
        ]
    },
    {
        "id": "varices",
        "title": "食道静脈瘤破裂 (上部消化管出血)",
        "patient": "55歳男性 (肝硬変既往)",
        "diagnosis": "食道静脈瘤破裂",
        "status": "danger",
        "vitals": {"hr": 128, "bp_sys": 74, "bp_dia": 42, "spo2": 90},
        "description": "病棟で突然 800mL の吐血があり意識混濁。窒息の危険とショック状態です。",
        "steps": [
            {
                "q": "病棟で突然 800mL の吐血があり意識混濁。窒息の危険とショック状態です。直ちにとるべき姿勢と初期対応は？",
                "opts": [
                    {"id": "var_pos", "text": "左側臥位にして気道を確保、吸引準備、細胞外液を全開輸液、緊急輸血を手配", "ok": True, "fb": "正解！吐血患者での最優先は窒息予防（側臥位）と急速輸液による循環不全の補正、および輸血確保です。"},
                    {"id": "var_ct", "text": "仰臥位で頭部を高くし、直ちに頭部CT室に搬送して意識障害の原因を調べる", "ok": False, "critical": True, "fb": "循環と呼吸が極めて不安定な状態でのCT室移送は禁忌です！移動中に窒息や心停止を起こします。"},
                    {"id": "var_trans", "text": "トランサミンとカルバゾクロム（止血剤）を静注し、氷水を飲ませて胃を冷やす", "ok": False, "fb": "静脈瘤の大量噴出性出血に対して止血薬や氷水は無力です。貴重な時間を浪費してしまいます。"}
                ]
            },
            {
                "q": "気道と初期輸液を確保しました。静脈瘤破裂による大量出血を止めるための薬物療法と止血処置は？",
                "opts": [
                    {"id": "var_evl", "text": "オクトレオチド静注と予防的抗菌薬を開始し、消化器内科に緊急内視鏡的結紮術（EVL）を依頼する", "ok": True, "fb": "大正解！門脈圧を下げるオクトレオチドと、感染を予防する抗菌薬の投与は静脈瘤出血の死亡率を有意に下げます。内視鏡による物理的止血が基本です。"},
                    {"id": "var_ppi", "text": "高用量PPI（プロトンポンプ阻害薬）を静注し、胃粘膜保護薬を投与して朝まで経過観察", "ok": False, "fb": "胃十二指腸潰瘍にはPPIが有効ですが、門脈圧亢進による食道静脈瘤出血には効果が薄く、放置すれば出血死します。"},
                    {"id": "var_hep", "text": "ヘパリンを静注して血管内凝固（DIC）を防ぎ、緊急胃手術を依頼する", "ok": False, "critical": True, "fb": "出血している患者に抗凝固薬（ヘパリン）を使用するのは致命的です！血が止まらなくなり即死します。"}
                ]
            }
        ]
    },
    {
        "id": "hyperkalemia",
        "title": "重篤な高カリウム血症",
        "patient": "72歳男性 (慢性腎臓病 CKD 5)",
        "diagnosis": "重篤な高カリウム血症",
        "status": "warning",
        "vitals": {"hr": 42, "bp_sys": 102, "bp_dia": 52, "spo2": 95},
        "description": "腎不全の患者が、数日前からの倦怠感と四肢の痺れ、高度の徐脈で搬送されました。",
        "steps": [
            {
                "q": "腎不全の患者が、数日前からの倦怠感と四肢の痺れ、高度の徐脈で搬送。まず最優先で行うべき検査は？",
                "opts": [
                    {"id": "k_ecg", "text": "12誘導心電図検査と、生化学検査（特にカリウム値）", "ok": True, "fb": "正解！腎不全＋しびれ＋徐脈では高カリウム血症を最優先で疑い、心電図（テント状T波、QRS幅拡大など）で致死性不整脈の予兆を評価します。"},
                    {"id": "k_mri", "text": "脳梗塞を疑い、直ちに脳MRIまたは頭部CTを行う", "ok": False, "fb": "しびれから脳卒中を疑うのは理解できますが、徐脈があり腎不全既往がある場合は、心停止リスクの高い電解質異常をまず心電図で除外すべきです。"},
                    {"id": "k_ct", "text": "頭部・胸部・腹部の緊急全身CT検査", "ok": False, "fb": "全身CTを撮っている間に、高K血症による心室細動（VF）や心停止が発生し致命的となる危険があります。"}
                ]
            },
            {
                "q": "心電図でQRS幅の著明な拡大を認め、K 7.6 mEq/L でした。心停止を防ぐため、今この瞬間に静脈投与すべき薬剤は？",
                "opts": [
                    {"id": "k_calc", "text": "カルチコール（グルコン酸カルシウム）10mL を5分かけて静脈内注射する", "ok": True, "fb": "大正解！カルシウムイオンは心筋の細胞膜電位を安定化させ、高K血症による致死性不整脈・心停止を即座に防ぐ最優先薬です（K値自体は下げません）。"},
                    {"id": "k_mate", "text": "カリメート（カリウム吸着薬）を内服または注腸投与する", "ok": False, "fb": "カリメートは腸管からカリウムを排出しますが、効果発現に数時間かかるため、この超緊急の心電図変化に対しては遅すぎます。"},
                    {"id": "k_ins_only", "text": "速効型インスリンを10単位単独で静脈注射する", "ok": False, "critical": True, "fb": "インスリンはカリウムを細胞内シフトさせますが、ブドウ糖を同時に投与（GI療法）しないと深刻な低血糖ショックを引き起こし極めて危険です。"}
                ]
            },
            {
                "q": "カルチコール静注によりQRS幅は一時的に縮小。カリウム値自体を下げるための一時的処置と、根本的除去の手配は？",
                "opts": [
                    {"id": "k_gi_hd", "text": "GI療法（ブドウ糖＋インスリン静注）と重炭酸ナトリウム静注を行い、緊急血液透析を依頼する", "ok": True, "fb": "完璧です！GI療法とメイロンでカリウムを細胞内へシフトさせて血中濃度を下げつつ、無尿の腎不全患者であるため透析でカリウムを体外へ除去します。"},
                    {"id": "k_lasix", "text": "大量の生理食塩水を輸液し、ループ利尿薬（ラシックス）を大量投与して尿からの排出を待つ", "ok": False, "fb": "CKD Stage 5の終末期腎不全患者では利尿薬に対する反応が極めて乏しく、尿からの排泄は期待できません。水分過剰による心不全を招くだけです。"},
                    {"id": "k_diet", "text": "水分制限を行い、カリウム制限を指導して一般病棟へ入院させる", "ok": False, "fb": "食事指導は慢性期の対応です。現在 K 7.6 で致死的不整脈の直前であり、急性期の緊急透析などによる除去が必要です。"}
                ]
            }
        ]
    },
    {
        "id": "copd",
        "title": "COPD急性増悪・CO2ナルコーシス",
        "patient": "82歳男性 (重症COPD)",
        "diagnosis": "COPD急性増悪・CO2ナルコーシス",
        "status": "warning",
        "vitals": {"hr": 115, "bp_sys": 138, "bp_dia": 84, "spo2": 91},
        "description": "数日前からの咳嗽・喀痰増加。夜間に呼吸困難が強まり、呼びかけで開眼するが朦朧としています。",
        "steps": [
            {
                "q": "夜間に呼吸困難が強まり、呼びかけで開眼するが朦朧。最初に行うべき適切な検査は？",
                "opts": [
                    {"id": "copd_gas", "text": "動脈血ガス分析と胸部X線検査", "ok": True, "fb": "正解！COPD患者の意識障害では、CO2貯留によるCO2ナルコーシスを強く疑い、動脈血ガス（pH, PaCO2, PaO2）でアシドーシスと二酸化炭素分圧を評価します。"},
                    {"id": "copd_o2", "text": "SpO2が91%と低いため、酸素マスク 10L/min に増量して様子を見る", "ok": False, "critical": True, "fb": "禁忌です！COPD患者に高濃度酸素を投与すると、呼吸中枢の駆動が消失し、肺胞換気が低下してCO2ナルコーシス（昏睡・呼吸停止）が悪化します。"},
                    {"id": "copd_sed", "text": "興奮・不穏と判断し、鎮静薬（アチバンなど）を注射して眠らせる", "ok": False, "critical": True, "fb": "呼吸抑制が強くかかり、自発呼吸が停止して窒息死します。絶対に避けてください！"}
                ]
            },
            {
                "q": "血液ガス結果：pH 7.23, PaCO2 82 mmHg, PaO2 54 mmHg でした。呼吸管理の第一選択は？",
                "opts": [
                    {"id": "copd_nppv", "text": "非侵襲的陽圧換気（NPPV）を装着し、適切な設定で呼吸補助を開始する", "ok": True, "fb": "大正解！COPD増悪による高炭酸ガス血症性呼吸不全には、気管挿管を避けるためにもNPPV（マスク型人工呼吸器）が第一選択です。"},
                    {"id": "copd_intubate", "text": "ただちに気管挿管を行い、鎮静・筋弛緩薬を使用して侵襲的人工呼吸器管理とする", "ok": False, "fb": "意識消失やNPPV不認容などの重篤な場合を除き、まずはNPPVを試みるのがガイドラインで推奨されています。挿管は離脱困難リスクがあります。"},
                    {"id": "copd_meilon", "text": "リザーバーマスクで酸素 10L/min を投与し、炭酸水素ナトリウム（メイロン）を静注する", "ok": False, "critical": True, "fb": "高濃度酸素投与はCO2貯留をさらに悪化させ昏睡に至らせます。また換気不全による呼吸性アシドーシスに対してアルカリ化薬は無効かつ有害です。"}
                ]
            },
            {
                "q": "NPPVにより、pH 7.34, PaCO2 56 mmHg と換気改善。COPD増悪への標準的薬物治療は？",
                "opts": [
                    {"id": "copd_meds", "text": "短時間作用性β2刺激薬（SABA）吸入、全身性ステロイド投与、必要に応じた抗菌薬の投与", "ok": True, "fb": "完璧です！SABA吸入、ステロイド、および感染が疑われる場合の抗菌薬投与がCOPD増悪治療の三原則です。"},
                    {"id": "copd_pulse", "text": "強力なステロイドパルス療法（メチルプレドニゾロン 1000mg 静注）を3日間施行する", "ok": False, "fb": "COPD増悪にステロイドパルスは過剰であり、副作用（感染症、血糖上昇）のリスクが高まります。通常は中等量の全身投与で十分です。"},
                    {"id": "copd_theo", "text": "アミノフィリン（テオフィリン製剤）を急速静注し、利尿薬（ラシックス）で心負荷を軽減する", "ok": False, "fb": "アミノフィリンの急性期急速静注は不整脈や悪心などの副作用が多く、推奨されません。心不全ではないため、利尿薬の適応もありません。"}
                ]
            }
        ]
    },
    # --- NURSE CALL EVENTS (1-step routine tasks) ---
    {
        "id": "leak",
        "title": "日常指示：点滴漏れ",
        "patient": "42歳女性 (腎盂腎炎で点滴中)",
        "diagnosis": "点滴漏れ・局所腫脹",
        "status": "warning",
        "vitals": {"hr": 88, "bp_sys": 115, "bp_dia": 75, "spo2": 95},
        "description": "病棟ナースから「点滴が入らなくなり、刺入部付近が赤く腫れています」と指示のコールです。",
        "steps": [
            {
                "q": "点滴漏れで腕の腫脹と痛みあり。指示として最も適切なのは？",
                "opts": [
                    {"id": "leak_reinsert", "text": "直ちに現在の点滴を抜去し、腫脹部を冷湿布、反対側の腕でルートを再確保するよう指示する", "ok": True, "fb": "正解！点滴漏れ時の標準対応です。即時抜去、冷却、別ルート再キープが基本です。"},
                    {"id": "leak_massage", "text": "漏れた刺入部をよく揉んでほぐし、点滴の速度を上げて流すよう指示する", "ok": False, "critical": True, "fb": "禁忌です！薬液の皮下漏出部位を揉むと組織壊死を悪化させます。絶対に揉んではいけません！"},
                    {"id": "leak_keep", "text": "次の予定抗菌薬の時間まで、そのまま抜去せず放置するよう指示する", "ok": False, "fb": "不適切です。漏出状態で放置すると痛みが強まるほか、重篤な静脈炎を誘発します。"}
                ]
            }
        ]
    },
    {
        "id": "insomnia",
        "title": "日常指示：不眠の訴え",
        "patient": "55歳男性 (慢性胃炎で入院中)",
        "diagnosis": "不眠の訴え",
        "status": "warning",
        "vitals": {"hr": 65, "bp_sys": 138, "bp_dia": 85, "spo2": 96},
        "description": "消灯後の病棟から「患者がどうしても眠れないので睡眠薬を出してほしいと希望しています」とコール。",
        "steps": [
            {
                "q": "バイタル安定、せん妄なし。眠薬の指示として適切なのは？",
                "opts": [
                    {"id": "ins_give", "text": "患者の既往歴や当直用指示を確認し、短時間作用型睡眠薬（ゾルピデムなど）を頓用で処方・指示する", "ok": True, "fb": "正解！禁忌（重症筋無力症や肺機能低下など）がないかを確認し、短時間作用型睡眠薬を頓用指示するのが一般的です。"},
                    {"id": "ins_refuse", "text": "睡眠薬は依存性があるため一切使用せず、朝まで目を閉じて我慢させるよう指示する", "ok": False, "fb": "不眠は患者の苦痛となり、翌日のせん妄や不穏を誘発します。適正使用の範囲であれば我慢させる必要はありません。"},
                    {"id": "ins_antipsychotic", "text": "強力な抗精神病薬（ハロペリドールなど）を直ちに静脈注射するよう指示する", "ok": False, "critical": True, "fb": "禁忌・過剰投与です！単なる不眠に対して、重篤な副作用リスクのある抗精神病薬の静注は行うべきではありません。"}
                ]
            }
        ]
    },
    {
        "id": "delirium",
        "title": "日常指示：夜間不穏・せん妄",
        "patient": "72歳男性 (大腸癌術後3日目)",
        "diagnosis": "夜間せん妄",
        "status": "warning",
        "vitals": {"hr": 85, "bp_sys": 128, "bp_dia": 82, "spo2": 95},
        "description": "夜間看護師から「佐藤さんが夜中に突然起き上がり、家に帰ると興奮して点滴を引き抜こうとしています！」とコール。",
        "steps": [
            {
                "q": "術後の夜間せん妄状態で興奮。自己抜管の危険あり。まず優先すべき指示は？",
                "opts": [
                    {"id": "del_family", "text": "見守りと声かけを依頼し、可能であれば点滴を一時ロックし、危険物から遠ざけて家族連絡を検討する", "ok": True, "fb": "正解！せん妄への初期対応です。環境調整と付き添い見守り、危険回避が優先され、安易な身体拘束や投薬は避けます。"},
                    {"id": "del_bind", "text": "直ちに体幹抑制帯でベッドに拘束し、睡眠薬を大量投与するよう指示する", "ok": False, "critical": True, "fb": "不適切です！安易な身体拘束はせん妄を悪化させます。また睡眠薬の過量投与は転倒や窒息リスクを激増させ危険です。"},
                    {"id": "del_none", "text": "自己抜管しても構わないので、そのままナースステーションで様子を見るよう指示する", "ok": False, "fb": "点滴抜去による大出血や感染、術後腹圧上昇などの医療事故を招くため、放置指示は不適切です。"}
                ]
            }
        ]
    }
]

# --- BASE PATIENT DATA ---
BASE_BEDS = {
    "101": {"patient": "佐藤 一郎 (72歳)", "diagnosis": "慢性心不全・経過観察", "status": "stable", "vitals": {"hr": 72, "bp_sys": 124, "bp_dia": 80, "spo2": 97}, "active_event": None},
    "102": {"patient": "鈴木 美咲 (28歳)", "diagnosis": "気管支喘息・点滴中", "status": "stable", "vitals": {"hr": 80, "bp_sys": 110, "bp_dia": 70, "spo2": 98}, "active_event": None},
    "103": {"patient": "高橋 健二 (55歳)", "diagnosis": "肝硬変・腹水管理", "status": "stable", "vitals": {"hr": 65, "bp_sys": 138, "bp_dia": 85, "spo2": 96}, "active_event": None},
    "104": {"patient": "田中 友美 (42歳)", "diagnosis": "腎盂腎炎・抗菌薬治療", "status": "stable", "vitals": {"hr": 88, "bp_sys": 115, "bp_dia": 75, "spo2": 95}, "active_event": None},
}

# --- SINGLE PLAYER ACTIVE SESSIONS ---
active_games = {}  # ws_id -> game_state
ws_to_user = {}     # ws_id -> user_email
ws_to_gas_url = {}  # ws_id -> gas_url (string or None)

def fetch_from_gas_sync(gas_url, email):
    """GASから同期的にユーザーデータを取得する"""
    try:
        params = {"email": email}
        query_string = urllib.parse.urlencode(params)
        url = f"{gas_url}?{query_string}"
        
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=5) as response:
            res_body = response.read().decode("utf-8")
            data = json.loads(res_body)
            return data
    except Exception as e:
        print(f"[GAS] Error fetching data from {gas_url}: {e}", flush=True)
        return None

def save_to_gas_sync(gas_url, payload):
    """GASへ同期的にユーザーデータを保存する"""
    try:
        req = urllib.request.Request(
            gas_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            res_body = response.read().decode("utf-8")
            data = json.loads(res_body)
            return data
    except Exception as e:
        print(f"[GAS] Error saving data to {gas_url}: {e}", flush=True)
        return None

async def fetch_from_gas(gas_url, email):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, fetch_from_gas_sync, gas_url, email)

async def save_to_gas(gas_url, payload):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, save_to_gas_sync, gas_url, payload)

def log_msg(ws_id, text):
    print(f"[{ws_id}] {text}", flush=True)
    if ws_id in active_games:
        state = active_games[ws_id]
        state["logs"].append(f"[{time.strftime('%H:%M:%S')}] {text}")
        if len(state["logs"]) > 25:
            state["logs"].pop(0)

# Calculate spawn interval based on current score
def get_spawn_interval(score):
    if score < 150:
        return 35  # Peace
    elif score < 300:
        return 20  # Busy
    else:
        return 12  # Panic

# Save user performance
async def save_user_score(ws_id):
    global users_db
    if ws_id not in ws_to_user or ws_id not in active_games:
        return
        
    email = ws_to_user[ws_id]
    state = active_games[ws_id]
    gas_url = ws_to_gas_url.get(ws_id)
    
    p_data = state["players"].get(str(ws_id))
    if not p_data:
        return
        
    score = p_data["score"]
    user_record = users_db[email]
    
    score_updated = False
    if score > user_record.get("high_score", 0):
        user_record["high_score"] = score
        score_updated = True
        log_msg(ws_id, f"🏆 自己ベスト更新！ハイスコア: {score} 点！")
        
    newly_completed = [d["id"] for d in state["debriefings"] if d["result"] == "SUCCESS"]
    orig_completed = user_record.get("completed_cases", [])
    merged_completed = list(set(orig_completed + newly_completed))
    
    if len(merged_completed) > len(orig_completed):
        user_record["completed_cases"] = merged_completed
        score_updated = True
        log_msg(ws_id, f"🎓 新たに {len(newly_completed)} 件の症例を習得し、学習進捗が保存されました。")
        
    if score_updated:
        save_db()
        if gas_url:
            log_msg(ws_id, f"📡 GASへのスコア同期中...")
            payload = {
                "email": email,
                "name": user_record["name"],
                "high_score": user_record["high_score"],
                "completed_cases": user_record["completed_cases"],
                "last_played": time.strftime("%Y-%m-%d %H:%M:%S")
            }
            gas_res = await save_to_gas(gas_url, payload)
            if gas_res and gas_res.get("status") == "success":
                log_msg(ws_id, "🟢 GASスプレッドシートへの同期が完了しました。")
            else:
                log_msg(ws_id, "⚠️ GASへの同期に失敗しました（ローカルにのみ保存されました）。")

# Load/Update user data
async def handle_login(ws_id, websocket, email, name, gas_url=None):
    global users_db
    email = email.lower().strip()
    
    if gas_url:
        ws_to_gas_url[ws_id] = gas_url
    else:
        ws_to_gas_url[ws_id] = None

    gas_data = None
    gas_success = False
    
    if gas_url:
        log_msg(ws_id, f"📡 GAS連携でのログイン試行中... URL: {gas_url}")
        gas_data = await fetch_from_gas(gas_url, email)
        if gas_data and gas_data.get("status") in ["success", "not_found"]:
            gas_success = True
            log_msg(ws_id, f"🟢 GASからデータ取得成功 (ステータス: {gas_data.get('status')})")
        else:
            log_msg(ws_id, "⚠️ GASからのデータ取得に失敗しました。ローカルモードにフォールバックします。")
            
    user_record = None
    
    if gas_success and gas_data:
        if gas_data.get("status") == "success":
            completed_cases = gas_data.get("completed_cases", [])
            if isinstance(completed_cases, str):
                completed_cases = completed_cases.split(",") if completed_cases else []
            
            user_record = {
                "email": email,
                "name": gas_data.get("name", name),
                "high_score": int(gas_data.get("high_score", 0)),
                "completed_cases": completed_cases,
                "last_played": gas_data.get("last_played", time.strftime("%Y-%m-%d %H:%M:%S"))
            }
            users_db[email] = user_record
            save_db()
            log_msg(ws_id, f"🔑 GASデータと同期してログイン成功: {email}")
        else:
            user_record = {
                "email": email,
                "name": name,
                "high_score": 0,
                "completed_cases": [],
                "last_played": time.strftime("%Y-%m-%d %H:%M:%S")
            }
            users_db[email] = user_record
            save_db()
            
            payload = {
                "email": email,
                "name": name,
                "high_score": 0,
                "completed_cases": [],
                "last_played": user_record["last_played"]
            }
            await save_to_gas(gas_url, payload)
            log_msg(ws_id, f"📝 GAS連携による新規アカウント登録: {email}")
    else:
        if email not in users_db:
            users_db[email] = {
                "email": email,
                "name": name,
                "high_score": 0,
                "completed_cases": [],
                "last_played": time.strftime("%Y-%m-%d %H:%M:%S")
            }
            save_db()
            log_msg(ws_id, f"📝 アカウント新規登録 (ローカル): {email} ({name})")
        else:
            users_db[email]["name"] = name
            users_db[email]["last_played"] = time.strftime("%Y-%m-%d %H:%M:%S")
            save_db()
            log_msg(ws_id, f"🔑 ログイン成功 (ローカル): {email}")
            
        user_record = users_db[email]
        
    ws_to_user[ws_id] = email
    
    await websocket.send(json.dumps({
        "type": "LOGIN_SUCCESS",
        "user": user_record,
        "gas_active": gas_success
    }))

# Spawn an emergency from available CLINICAL_CASES (scaling difficulty)
def spawn_emergency(ws_id):
    if ws_id not in active_games:
        return
        
    state = active_games[ws_id]
    if state["status"] != "PLAYING":
        return
        
    p_score = 0
    p_data = state["players"].get(str(ws_id))
    if p_data:
        p_score = p_data["score"]
        
    active_case_ids = [bed["active_event"]["id"] for bed in state["beds"].values() if bed["active_event"]]
    solved_case_ids = [d["id"] for d in state["debriefings"]]
    
    available_cases = []
    for c in CLINICAL_CASES:
        if c["id"] in active_case_ids or c["id"] in solved_case_ids:
            continue
        # Filter minor nurse calls if score is too low
        if p_score < 150 and c["id"] in ["leak", "insomnia", "delirium"]:
            continue
        available_cases.append(c)
        
    if not available_cases:
        return
        
    chosen_case = random.choice(available_cases)
    
    stable_beds = [bid for bid, bed in state["beds"].items() if bed["status"] == "stable"]
    if stable_beds:
        bed_id = random.choice(stable_beds)
    else:
        existing_ids = [int(bid) for bid in state["beds"].keys() if bid.isdigit()]
        new_bid = str(max(existing_ids) + 1) if existing_ids else "105"
        state["beds"][new_bid] = {
            "patient": "",
            "diagnosis": "",
            "status": "stable",
            "vitals": {},
            "active_event": None
        }
        bed_id = new_bid
        
    bed = state["beds"][bed_id]
    bed["patient"] = chosen_case["patient"]
    bed["diagnosis"] = f"{chosen_case['title']}疑い"
    bed["status"] = chosen_case["status"]
    bed["vitals"] = dict(chosen_case["vitals"])
    bed["active_event"] = {
        "id": chosen_case["id"],
        "title": chosen_case["title"],
        "diagnosis": chosen_case["diagnosis"],
        "description": chosen_case["description"],
        "steps": chosen_case["steps"],
        "current_step": 0,
        "last_feedback": None
    }
    
    log_msg(ws_id, f"🚨 【当直コール】{bed_id}号室 ({bed['patient']}) が急変！「{chosen_case['title']}」が疑われます！")

# Client-specific Timer Loop
async def client_timer_loop(ws_id, websocket):
    try:
        while True:
            await asyncio.sleep(1.0)
            
            if ws_id not in active_games:
                break
                
            state = active_games[ws_id]
            if state["status"] == "PLAYING":
                state["time_left"] -= 1
                
                # Check all beds vitals decay / recovery
                for bid, bed in list(state["beds"].items()):
                    evt = bed["active_event"]
                    if not evt:
                        v = bed["vitals"]
                        if bid == "101":
                            v["hr"] = max(72, v["hr"] - 2) if v["hr"] > 72 else min(72, v["hr"] + 2)
                            v["bp_sys"] = max(124, v["bp_sys"] - 2) if v["bp_sys"] > 124 else min(124, v["bp_sys"] + 2)
                            v["spo2"] = min(97, v["spo2"] + 1)
                        elif bid == "102":
                            v["hr"] = max(80, v["hr"] - 2) if v["hr"] > 80 else min(80, v["hr"] + 2)
                            v["bp_sys"] = max(110, v["bp_sys"] - 2) if v["bp_sys"] > 110 else min(110, v["bp_sys"] + 2)
                            v["spo2"] = min(98, v["spo2"] + 1)
                        elif bid == "103":
                            v["hr"] = max(65, v["hr"] - 2) if v["hr"] > 65 else min(65, v["hr"] + 2)
                            v["bp_sys"] = max(138, v["bp_sys"] - 2) if v["bp_sys"] > 138 else min(138, v["bp_sys"] + 2)
                            v["spo2"] = min(96, v["spo2"] + 1)
                        elif bid == "104":
                            v["hr"] = max(88, v["hr"] - 2) if v["hr"] > 88 else min(88, v["hr"] + 2)
                            v["bp_sys"] = max(115, v["bp_sys"] - 2) if v["bp_sys"] > 115 else min(115, v["bp_sys"] + 2)
                            v["spo2"] = min(95, v["spo2"] + 1)
                        continue
                    
                    v = bed["vitals"]
                    c_id = evt["id"]
                    step = evt["current_step"]
                    
                    # Decelerated (eased) vitals decay rates
                    if c_id == "dka":
                        if step == 0:
                            v["bp_sys"] = max(40, v["bp_sys"] - 1)
                            v["hr"] = min(140, v["hr"] + 1)
                            if v["bp_sys"] < 80:
                                state["safety"] = max(0, state["safety"] - 1)  # 2 -> 1 (eased)
                        else:
                            v["bp_sys"] = min(110, v["bp_sys"] + 2)
                            v["hr"] = max(90, v["hr"] - 1)
                            
                    elif c_id == "dissection":
                        if step == 0:
                            v["bp_sys"] = min(220, v["bp_sys"] + 2)
                            v["hr"] = min(140, v["hr"] + 1)
                            if v["bp_sys"] > 190:
                                state["safety"] = max(0, state["safety"] - 2)  # 4 -> 2 (eased)
                        else:
                            v["bp_sys"] = max(115, v["bp_sys"] - 3)
                            v["hr"] = max(70, v["hr"] - 2)
                            
                    elif c_id == "sepsis":
                        if step == 0:
                            v["bp_sys"] = max(40, v["bp_sys"] - 2)
                            v["hr"] = min(150, v["hr"] + 2)
                            if v["bp_sys"] < 75:
                                # average -1.5% per second (eased from -3%)
                                penalty = 2 if state["time_left"] % 2 == 0 else 1
                                state["safety"] = max(0, state["safety"] - penalty)
                        else:
                            v["bp_sys"] = min(95, v["bp_sys"] + 2)
                            v["hr"] = max(90, v["hr"] - 1)
                            
                    elif c_id == "varices":
                        if step == 0:
                            v["bp_sys"] = max(45, v["bp_sys"] - 3)
                            v["hr"] = min(150, v["hr"] + 2)
                            v["spo2"] = max(60, v["spo2"] - 1)
                            if v["bp_sys"] < 70 or v["spo2"] < 85:
                                # average -2.5% per second (eased from -5%)
                                penalty = 3 if state["time_left"] % 2 == 0 else 2
                                state["safety"] = max(0, state["safety"] - penalty)
                        else:
                            v["bp_sys"] = min(90, v["bp_sys"] + 3)
                            v["spo2"] = min(95, v["spo2"] + 2)
                            
                    elif c_id == "hyperkalemia":
                        if step == 0:
                            v["hr"] = max(25, v["hr"] - 2)
                            if v["hr"] < 35:
                                # average -2.5% per second (eased from -5%)
                                penalty = 3 if state["time_left"] % 2 == 0 else 2
                                state["safety"] = max(0, state["safety"] - penalty)
                        elif step == 1:
                            v["hr"] = min(50, v["hr"] + 2)
                        else:
                            v["hr"] = min(60, v["hr"] + 3)
                            
                    elif c_id == "copd":
                        if step == 0:
                            v["spo2"] = max(50, v["spo2"] - 2)
                            if v["spo2"] < 80:
                                state["safety"] = max(0, state["safety"] - 2)  # 4 -> 2 (eased)
                        else:
                            v["spo2"] = min(95, v["spo2"] + 3)
                            
                # --- HEALTH NATURAL RECOVERY SYSTEM ---
                # Recover 1% safety every 3s of peaceful environment (no active emergencies)
                has_active_emergency = any(bed["active_event"] is not None for bed in state["beds"].values())
                if not has_active_emergency:
                    state["peaceful_seconds"] += 1
                    if state["peaceful_seconds"] >= 3:
                        if state["safety"] < MAX_SAFETY:
                            state["safety"] = min(MAX_SAFETY, state["safety"] + 1)
                            log_msg(ws_id, "💚 病棟が平穏に維持され、患者安全度が自然回復しました (+1%)")
                        state["peaceful_seconds"] = 0
                else:
                    state["peaceful_seconds"] = 0
                
                # Check Game Over / Clear
                if state["safety"] <= 0:
                    state["status"] = "RESULT"
                    log_msg(ws_id, "💀 患者安全度が0%になり、重大なインシデントにより当直失敗（ゲームオーバー）！")
                    await save_user_score(ws_id)
                elif state["time_left"] <= 0:
                    state["status"] = "RESULT"
                    log_msg(ws_id, "🎉 シフト終了！すべての当直急変に適切に対処できました！")
                    await save_user_score(ws_id)
                    
                # Dynamic Difficulty Scaling (Spawn timer)
                p_score = 0
                p_data = state["players"].get(str(ws_id))
                if p_data:
                    p_score = p_data["score"]
                    
                state["seconds_since_last_spawn"] += 1
                current_interval = get_spawn_interval(p_score)
                if state["seconds_since_last_spawn"] >= current_interval:
                    spawn_emergency(ws_id)
                    state["seconds_since_last_spawn"] = 0
                
                # Send update to single player
                await websocket.send(json.dumps({"type": "STATE_UPDATE", "state": state}))
                
    except asyncio.CancelledError:
        pass

# WebSocket handler
async def handler(websocket):
    ws_id = id(websocket)
    print(f"Client connected: {ws_id}", flush=True)
    
    # Initialize separate game state
    active_games[ws_id] = {
        "status": "LOBBY",
        "players": {},
        "safety": MAX_SAFETY,
        "time_left": GAME_DURATION,
        "beds": {},
        "logs": [],
        "debriefings": [],
        "seconds_since_last_spawn": 0,
        "peaceful_seconds": 0
    }
    
    timer_task = asyncio.create_task(client_timer_loop(ws_id, websocket))
    
    try:
        await websocket.send(json.dumps({"type": "INITIAL_STATE", "state": active_games[ws_id]}))
        
        async for message in websocket:
            data = json.loads(message)
            msg_type = data.get("type")
            state = active_games[ws_id]
            
            if msg_type == "USER_LOGIN":
                email = data.get("email", "demo@test.com")
                name = data.get("name", "テスト専攻医")
                gas_url = data.get("gas_url")
                
                await handle_login(ws_id, websocket, email, name, gas_url)
                
                state["players"][str(ws_id)] = {
                    "name": name,
                    "score": 0,
                    "color": "#3b82f6"
                }
                log_msg(ws_id, f"🩺 {name} 医師がログインして当直に入りました。")
                await websocket.send(json.dumps({"type": "STATE_UPDATE", "state": state}))
                
            elif msg_type == "START_GAME":
                if state["status"] in ["LOBBY", "RESULT"]:
                    state["status"] = "PLAYING"
                    state["safety"] = MAX_SAFETY
                    state["time_left"] = GAME_DURATION
                    state["logs"] = []
                    state["debriefings"] = []
                    state["seconds_since_last_spawn"] = 0
                    state["peaceful_seconds"] = 0
                    
                    state["beds"] = {}
                    for bid, bdata in BASE_BEDS.items():
                        state["beds"][bid] = {
                            "patient": bdata["patient"],
                            "diagnosis": bdata["diagnosis"],
                            "status": bdata["status"],
                            "vitals": dict(bdata["vitals"]),
                            "active_event": None
                        }
                        
                    if str(ws_id) in state["players"]:
                        state["players"][str(ws_id)]["score"] = 0
                        
                    log_msg(ws_id, "🚀 専攻医当直開始！急変コールや救急搬送に適切に指示を出してください。")
                    spawn_emergency(ws_id)
                    
                await websocket.send(json.dumps({"type": "STATE_UPDATE", "state": state}))
                
            elif msg_type == "PERFORM_ACTION":
                bed_id = data.get("bed_id")
                action_id = data.get("action_id")
                
                if state["status"] != "PLAYING" or str(ws_id) not in state["players"]:
                    continue
                    
                p = state["players"][str(ws_id)]
                bed = state["beds"].get(bed_id)
                
                if not bed or not bed["active_event"]:
                    continue
                    
                evt = bed["active_event"]
                step_idx = evt["current_step"]
                current_step_data = evt["steps"][step_idx]
                
                selected_opt = None
                for opt in current_step_data["opts"]:
                    if opt["id"] == action_id:
                        selected_opt = opt
                        break
                        
                if not selected_opt:
                    continue
                    
                if selected_opt["ok"]:
                    evt["current_step"] += 1
                    p["score"] += 50
                    
                    # Distinguish heavy vs light call for score & safety recovery
                    is_nurse_call = evt["id"] in ["leak", "insomnia", "delirium"]
                    if is_nurse_call:
                        p["score"] -= 20  # +30 points instead of +50
                        recovery = 5
                    else:
                        recovery = 8
                        
                    # Recover safety upon correct decision!
                    state["safety"] = min(MAX_SAFETY, state["safety"] + recovery)
                    evt["last_feedback"] = f"✅ 【適切】 (安全度 +{recovery}%) {selected_opt['fb']}"
                    log_msg(ws_id, f"✅ 処置適切: {bed_id}号室 - {selected_opt['text']} (安全度 +{recovery}%)")
                    
                    if evt["current_step"] >= len(evt["steps"]):
                        bed["status"] = "stable"
                        bed["diagnosis"] = evt["diagnosis"]
                        bed["active_event"] = None
                        bonus = 10 if is_nurse_call else 30
                        p["score"] += bonus
                        
                        log_msg(ws_id, f"✨ {bed_id}号室の {bed['patient']} の状態は安定しました。")
                        
                        state["debriefings"].append({
                            "id": evt["id"],
                            "patient": bed["patient"],
                            "diagnosis": evt["diagnosis"],
                            "title": evt["title"],
                            "saved_by": p["name"],
                            "result": "SUCCESS"
                        })
                else:
                    is_critical = selected_opt.get("critical", False)
                    p["score"] = max(0, p["score"] - 10)
                    
                    penalty = 15 if is_critical else 7  # eased: 25->15, 12->7
                    state["safety"] = max(0, state["safety"] - penalty)
                    evt["last_feedback"] = f"❌ 【不適切】 (安全度 -{penalty}%) {selected_opt['fb']}"
                    
                    severity_str = "【致命的ミス】" if is_critical else ""
                    log_msg(ws_id, f"❌ 処置不適切: {bed_id}号室 - {selected_opt['text']} {severity_str} (安全度 -{penalty}%)")
                    
                await websocket.send(json.dumps({"type": "STATE_UPDATE", "state": state}))
                
    except Exception as e:
        print(f"Error handling connection: {e}", flush=True)
    finally:
        timer_task.cancel()
        if ws_id in active_games:
            del active_games[ws_id]
        if ws_id in ws_to_user:
            del ws_to_user[ws_id]
        if ws_id in ws_to_gas_url:
            del ws_to_gas_url[ws_id]
        print(f"Client disconnected: {ws_id}", flush=True)

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.join(os.path.dirname(__file__), 'public'), **kwargs)

def start_http_server():
    os.makedirs(os.path.join(os.path.dirname(__file__), 'public'), exist_ok=True)
    handler_class = CustomHTTPRequestHandler
    with socketserver.TCPServer(("", HTTP_PORT), handler_class) as httpd:
        print(f"HTTP Server serving static files at http://localhost:{HTTP_PORT}", flush=True)
        httpd.serve_forever()

async def main():
    http_thread = threading.Thread(target=start_http_server, daemon=True)
    http_thread.start()
    
    import websockets
    print(f"WebSocket Server starting on ws://0.0.0.0:{WS_PORT}", flush=True)
    
    async with websockets.serve(handler, "0.0.0.0", WS_PORT):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nServer stopped.", flush=True)
