function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);
    var action = params.action;
    
    // 症例データの一覧同期 (実行ユーザー: 自分(システム)のデプロイで実行。CORS制限なし)
    if (action === "sync_cases") {
      var cases = params.cases;
      if (!Array.isArray(cases)) throw new Error("Cases array required");
      
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName("CaseMaster");
      if (!sheet) {
        sheet = ss.insertSheet("CaseMaster");
        sheet.appendRow(["症例ID", "疾患名", "主訴", "患者情報", "確定診断名", "状況説明", "出典タイトル", "出典URL"]);
        sheet.getRange(1, 1, 1, 8).setFontWeight("bold").setBackground("#dcfce7"); // 薄緑
      }
      
      var data = sheet.getDataRange().getValues();
      var idRowMap = {};
      for (var i = 1; i < data.length; i++) {
        if (data[i][0]) {
          idRowMap[data[i][0].toString()] = i + 1;
        }
      }
      
      for (var j = 0; j < cases.length; j++) {
        var c = cases[j];
        var cid = c.id || "";
        var title = c.title || "";
        var complaint = c.complaint || "";
        var patient = c.patient || "";
        var diagnosis = c.diagnosis || "";
        var description = c.description || "";
        var sourceTitle = (c.source && c.source.title) || "";
        var sourceUrl = (c.source && c.source.url) || "";
        
        var rowValues = [cid, title, complaint, patient, diagnosis, description, sourceTitle, sourceUrl];
        
        if (idRowMap[cid]) {
          sheet.getRange(idRowMap[cid], 1, 1, 8).setValues([rowValues]);
        } else {
          sheet.appendRow(rowValues);
          idRowMap[cid] = sheet.getLastRow();
        }
      }
      
      return ContentService.createTextOutput(JSON.stringify({status: "success", count: cases.length}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // --- プレイヤー用のスコア保存 / ユーザー名登録 ---
    // パラメータ取得
    var email = (params.email || "").toLowerCase().trim();
    if (!email) throw new Error("Email required");
    
    // セキュリティチェック: OTP認証が成功しているか (OTPシートで Verified が TRUE か)
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var otpSheet = ss.getSheetByName("OTP");
    var isVerified = false;
    
    if (otpSheet) {
      var otpData = otpSheet.getDataRange().getValues();
      for (var i = 1; i < otpData.length; i++) {
        if (otpData[i][0] && otpData[i][0].toString().toLowerCase() === email) {
          if (otpData[i][3] === true || otpData[i][3].toString().toUpperCase() === "TRUE") {
            isVerified = true;
            break;
          }
        }
      }
    }
    
    // テスト環境や管理用のフォールバック (resident@gmail.com のようなテストアドレスはパスコードなしで通す)
    if (email.indexOf("resident") === 0 && email.indexOf("@gmail.com") !== -1) {
      isVerified = true; 
    }
    
    if (!isVerified) {
      throw new Error("Authentication required. Please request and verify OTP code first.");
    }
    
    if (action === "stats") {
      var caseId = params.case_id;
      var tried = parseInt(params.tried) || 0;
      var correct = parseInt(params.correct) || 0;
      
      var sheet = ss.getSheetByName("Stats");
      if (!sheet) {
        sheet = ss.insertSheet("Stats");
        sheet.appendRow(["Case ID", "Tried", "Correct"]);
        sheet.getRange(1, 1, 1, 3).setFontWeight("bold").setBackground("#f3f3f3");
      }
      
      var data = sheet.getDataRange().getValues();
      var foundRow = -1;
      
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] && data[i][0].toString() === caseId) {
          foundRow = i + 1;
          break;
        }
      }
      
      if (foundRow !== -1) {
        var currentTried = parseInt(sheet.getRange(foundRow, 2).getValue()) || 0;
        var currentCorrect = parseInt(sheet.getRange(foundRow, 3).getValue()) || 0;
        sheet.getRange(foundRow, 2).setValue(currentTried + tried);
        sheet.getRange(foundRow, 3).setValue(currentCorrect + correct);
      } else {
        sheet.appendRow([caseId, tried, correct]);
      }
      
      return ContentService.createTextOutput(JSON.stringify({status: "success"}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // プレイヤースコア保存ロジック / ユーザー登録
    var name = params.name;
    var highScore = parseInt(params.high_score) || 0;
    var completedCasesStr = "";
    if (params.completed_cases) {
      completedCasesStr = Array.isArray(params.completed_cases) ? params.completed_cases.join(",") : params.completed_cases.toString();
    }
    var lastPlayed = params.last_played || new Date().toLocaleString("ja-JP", {timeZone: "Asia/Tokyo"});
    
    var sheet = ss.getSheetByName("Users") || ss.getActiveSheet();
    if (sheet.getName() !== "Users") sheet.setName("Users");
    
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Email", "Name", "High Score", "Completed Cases", "Last Played"]);
      sheet.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#f3f3f3");
    }
    
    var data = sheet.getDataRange().getValues();
    var foundRow = -1;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().toLowerCase() === email) {
        foundRow = i + 1;
        break;
      }
    }
    
    var finalName = name ? name.toString().trim() : "";
    if (foundRow !== -1) {
      var existingName = (data[foundRow - 1][1] || "").toString().trim();
      // すでに固有の医師名が設定されている場合は、上書きを禁止する
      if (existingName && existingName !== "匿名医師" && existingName !== "テスト専攻医" && finalName) {
        finalName = existingName; 
      } else if (!finalName) {
        finalName = existingName || "匿名医師";
      }
      
      sheet.getRange(foundRow, 2).setValue(finalName);
      sheet.getRange(foundRow, 3).setValue(highScore);
      sheet.getRange(foundRow, 4).setValue(completedCasesStr);
      sheet.getRange(foundRow, 5).setValue(lastPlayed);
    } else {
      if (!finalName) finalName = "匿名医師";
      sheet.appendRow([email, finalName, highScore, completedCasesStr, lastPlayed]);
    }
    
    return ContentService.createTextOutput(JSON.stringify({status: "success", email: email, name: finalName}))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({status: "error", message: err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    var action = e.parameter.action;
    var email = (e.parameter.email || "").toLowerCase().trim();
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    if (action === "get_stats") {
      var sheet = ss.getSheetByName("Stats");
      var stats = {};
      if (sheet && sheet.getLastRow() > 1) {
        var data = sheet.getDataRange().getValues();
        for (var i = 1; i < data.length; i++) {
          if (data[i][0]) {
            stats[data[i][0].toString()] = {
              tried: parseInt(data[i][1]) || 0,
              correct: parseInt(data[i][2]) || 0
            };
          }
        }
      }
      return ContentService.createTextOutput(JSON.stringify(stats))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // --- 1. OTPコードの生成・送信 ---
    if (action === "send_otp") {
      if (!email) throw new Error("Email parameter required");
      
      // 6桁のランダムコード
      var code = "";
      for (var i = 0; i < 6; i++) {
        code += Math.floor(Math.random() * 10).toString();
      }
      
      var expireTime = new Date().getTime() + (10 * 60 * 1000); // 10分有効
      
      var sheet = ss.getSheetByName("OTP");
      if (!sheet) {
        sheet = ss.insertSheet("OTP");
        sheet.appendRow(["Email", "Code", "Expire", "Verified"]);
        sheet.getRange(1, 1, 1, 4).setFontWeight("bold").setBackground("#f3f3f3");
      }
      
      var data = sheet.getDataRange().getValues();
      var foundRow = -1;
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] && data[i][0].toString().toLowerCase() === email) {
          foundRow = i + 1;
          break;
        }
      }
      
      var rowValues = [email, code, expireTime, false];
      if (foundRow !== -1) {
        sheet.getRange(foundRow, 1, 1, 4).setValues([rowValues]);
      } else {
        sheet.appendRow(rowValues);
      }
      
      // メール送信 (resident で始まるテスト用アドレスの場合は送信をスキップして成功扱いにする)
      if (!(email.indexOf("resident") === 0 && email.indexOf("@gmail.com") !== -1)) {
        var subject = "【内科当直シミュレーター】ログイン認証コード";
        var body = "内科当直シミュレーターをご利用いただきありがとうございます。\n\n" +
                   "あなたのログイン用認証コードは以下になります：\n\n" +
                   "  " + code + "\n\n" +
                   "有効期限は10分間です。ゲームのコード入力画面に入力してください。\n" +
                   "※本メールに心当たりがない場合は、破棄してください。\n";
        
        GmailApp.sendEmail(email, subject, body);
      } else {
        // テスト用コードをログに出力 (検証用)
        console.log("Test Login OTP generated for " + email + ": " + code);
      }
      
      // テスト用アドレスの場合は、開発利便性のためにコードをフロントに返してあげる (実用時はセキュリティのため隠してもよいが、今回はresident@gmail.com専用)
      var resObj = {status: "success"};
      if (email.indexOf("resident") === 0 && email.indexOf("@gmail.com") !== -1) {
        resObj.test_code = code; // テスト用
      }
      
      return ContentService.createTextOutput(JSON.stringify(resObj))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // --- 2. OTPコードの検証 ---
    if (action === "verify_otp") {
      var code = (e.parameter.code || "").trim();
      if (!email || !code) throw new Error("Email and Code parameters required");
      
      var sheet = ss.getSheetByName("OTP");
      if (!sheet) throw new Error("No OTP records found.");
      
      var data = sheet.getDataRange().getValues();
      var isValid = false;
      var foundRow = -1;
      
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] && data[i][0].toString().toLowerCase() === email) {
          var savedCode = data[i][1].toString().trim();
          var expire = parseInt(data[i][2]) || 0;
          var now = new Date().getTime();
          
          // テスト用アドレス、またはコードが一致かつ有効期限内
          if ((email.indexOf("resident") === 0 && email.indexOf("@gmail.com") !== -1 && code === savedCode) || 
              (savedCode === code && now < expire)) {
            isValid = true;
            foundRow = i + 1;
            break;
          }
        }
      }
      
      if (!isValid) {
        return ContentService.createTextOutput(JSON.stringify({status: "error", message: "認証コードが正しくないか、有効期限が切れています。"}))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      // Verified フラグを TRUE に更新 (1時間有効にするためにExpireも再延長)
      var extendedExpire = new Date().getTime() + (60 * 60 * 1000); // 1時間セッション維持
      sheet.getRange(foundRow, 3).setValue(extendedExpire);
      sheet.getRange(foundRow, 4).setValue(true);
      
      // ユーザーの登録状況をチェックして返す
      var userSheet = ss.getSheetByName("Users");
      var userRecord = { email: email, name: "匿名医師", high_score: 0, completed_cases: [], last_played: "", status: "not_registered" };
      
      if (userSheet && userSheet.getLastRow() > 1) {
        var userData = userSheet.getDataRange().getValues();
        var foundUser = false;
        for (var k = 1; k < userData.length; k++) {
          if (userData[k][0] && userData[k][0].toString().toLowerCase() === email) {
            var uName = (userData[k][1] || "").toString().trim();
            userRecord = {
              email: userData[k][0],
              name: uName || "匿名医師",
              high_score: parseInt(userData[k][2]) || 0,
              completed_cases: userData[k][3] ? userData[k][3].toString().split(",") : [],
              last_played: userData[k][4] ? userData[k][4].toString() : "",
              status: (!uName || uName === "匿名医師") ? "not_registered" : "success"
            };
            foundUser = true;
            break;
          }
        }
        if (!foundUser) {
          userRecord.status = "not_found";
        }
      } else {
        userRecord.status = "not_found";
      }
      
      return ContentService.createTextOutput(JSON.stringify(userRecord))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // --- 3. セッションのサイレント確認 (リロード時用) ---
    if (action === "silent_check") {
      if (!email) throw new Error("Email parameter required");
      
      var sheet = ss.getSheetByName("OTP");
      var isSessionValid = false;
      
      if (sheet) {
        var data = sheet.getDataRange().getValues();
        for (var i = 1; i < data.length; i++) {
          if (data[i][0] && data[i][0].toString().toLowerCase() === email) {
            var expire = parseInt(data[i][2]) || 0;
            var verified = data[i][3];
            var now = new Date().getTime();
            
            // 検証済みかつセッション期限内
            if ((verified === true || verified.toString().toUpperCase() === "TRUE") && now < expire) {
              isSessionValid = true;
              break;
            }
          }
        }
      }
      
      if (!isSessionValid) {
        return ContentService.createTextOutput(JSON.stringify({status: "unauthenticated"}))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      // ユーザーの登録状況をチェック
      var userSheet = ss.getSheetByName("Users");
      var userRecord = { email: email, name: "匿名医師", high_score: 0, completed_cases: [], last_played: "", status: "not_registered" };
      
      if (userSheet && userSheet.getLastRow() > 1) {
        var userData = userSheet.getDataRange().getValues();
        var foundUser = false;
        for (var k = 1; k < userData.length; k++) {
          if (userData[k][0] && userData[k][0].toString().toLowerCase() === email) {
            var uName = (userData[k][1] || "").toString().trim();
            userRecord = {
              email: userData[k][0],
              name: uName || "匿名医師",
              high_score: parseInt(userData[k][2]) || 0,
              completed_cases: userData[k][3] ? userData[k][3].toString().split(",") : [],
              last_played: userData[k][4] ? userData[k][4].toString() : "",
              status: (!uName || uName === "匿名医師") ? "not_registered" : "success"
            };
            foundUser = true;
            break;
          }
        }
        if (!foundUser) {
          userRecord.status = "not_found";
        }
      }
      
      return ContentService.createTextOutput(JSON.stringify(userRecord))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // デフォルト: 404
    throw new Error("Invalid action parameter");
    
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({status: "error", message: err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
