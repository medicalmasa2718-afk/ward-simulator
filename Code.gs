function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);
    var action = params.action;
    
    // 症例データの一覧同期 (実行ユーザー: 自分(システム)のデプロイで実行)
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
    
    // --- プレイヤー用の処理 (実行ユーザー: アクセスしているユーザーのデプロイで実行) ---
    var activeEmail = Session.getActiveUser().getEmail();
    if (!activeEmail) {
      throw new Error("Google Authentication required. Please authenticate first.");
    }
    activeEmail = activeEmail.toLowerCase().trim();
    
    if (action === "stats") {
      var caseId = params.case_id;
      var tried = parseInt(params.tried) || 0;
      var correct = parseInt(params.correct) || 0;
      
      var ss = SpreadsheetApp.getActiveSpreadsheet();
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
    
    // プレイヤースコア保存ロジック (emailは偽装防止のため activeEmail を強制)
    var email = activeEmail;
    var name = params.name;
    var highScore = parseInt(params.high_score) || 0;
    var completedCasesStr = "";
    if (params.completed_cases) {
      completedCasesStr = Array.isArray(params.completed_cases) ? params.completed_cases.join(",") : params.completed_cases.toString();
    }
    var lastPlayed = params.last_played || new Date().toLocaleString("ja-JP", {timeZone: "Asia/Tokyo"});
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
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
      // すでに「匿名医師」や「テスト専攻医」以外の固有のユーザー名が設定されている場合は、上書きを禁止する
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
    var callback = e.parameter.callback; // JSONP用のコールバックパラメータ
    
    if (action === "get_stats") {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
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
      var jsonString = JSON.stringify(stats);
      if (callback) {
        return ContentService.createTextOutput(callback + "(" + jsonString + ")")
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      }
      return ContentService.createTextOutput(jsonString)
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 別窓認証用のエンドポイント
    if (action === "auth_trigger") {
      var activeEmail = Session.getActiveUser().getEmail();
      var htmlContent = "";
      if (activeEmail) {
        var email = activeEmail.toLowerCase().trim();
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var sheet = ss.getSheetByName("Users") || ss.getActiveSheet();
        
        var userRecord = { email: email, name: "匿名医師", high_score: 0, completed_cases: [], last_played: "", status: "not_found" };
        
        if (sheet.getLastRow() > 1) {
          var data = sheet.getDataRange().getValues();
          var found = false;
          for (var i = 1; i < data.length; i++) {
            if (data[i][0] && data[i][0].toString().toLowerCase() === email) {
              var uName = (data[i][1] || "").toString().trim();
              userRecord = {
                email: data[i][0],
                name: uName || "匿名医師",
                high_score: parseInt(data[i][2]) || 0,
                completed_cases: data[i][3] ? data[i][3].toString().split(",") : [],
                last_played: data[i][4] ? data[i][4].toString() : "",
                status: (!uName || uName === "匿名医師") ? "not_registered" : "success"
              };
              found = true;
              break;
            }
          }
          if (!found) {
            userRecord.status = "not_found";
          }
        }
        
        htmlContent = "<html><head><meta charset='UTF-8'><title>認証成功</title></head>" +
                      "<body style='font-family: sans-serif; text-align: center; padding-top: 100px; background: #0f172a; color: #fff;'>" +
                      "<div style='background: rgba(255,255,255,0.05); display: inline-block; padding: 40px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);'>" +
                      "<h2 style='color: #22c55e; margin-bottom: 10px;'>✓ 認証成功</h2>" +
                      "<p style='font-size: 1.1rem; margin-bottom: 20px;'>Google アカウント (" + email + ") の連携に成功しました。</p>" +
                      "<p style='color: #94a3b8; font-size: 0.9rem;'>このウィンドウは自動的に閉じます。ゲーム画面に戻ってください。</p>" +
                      "</div>" +
                      "<script>" +
                      "  var dataToSend = " + JSON.stringify(userRecord) + ";" +
                      "  if (window.opener) {" +
                      "    window.opener.postMessage({ type: 'AUTH_SUCCESS', data: dataToSend }, '*');" +
                      "  }" +
                      "  setTimeout(function(){ window.close(); }, 2000);" +
                      "</script>" +
                      "</body></html>";
      } else {
        htmlContent = "<html><head><meta charset='UTF-8'><title>認証エラー</title></head>" +
                      "<body style='font-family: sans-serif; text-align: center; padding-top: 100px; background: #0f172a; color: #fff;'>" +
                      "<div style='background: rgba(255,255,255,0.05); display: inline-block; padding: 40px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);'>" +
                      "<h2 style='color: #ef4444; margin-bottom: 10px;'>⚠ 認証エラー</h2>" +
                      "<p style='font-size: 1.1rem;'>Google アカウントのログイン状態が検出できませんでした。</p>" +
                      "</div>" +
                      "</body></html>";
      }
      return HtmlService.createHtmlOutput(htmlContent);
    }
    
    // ログイン情報の自動確認 (action === "login_check" またはデフォルト)
    var activeEmail = Session.getActiveUser().getEmail();
    if (!activeEmail) {
      var unauthObj = {status: "unauthenticated"};
      if (callback) {
        return ContentService.createTextOutput(callback + "(" + JSON.stringify(unauthObj) + ")")
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      }
      return ContentService.createTextOutput(JSON.stringify(unauthObj))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var email = activeEmail.toLowerCase().trim();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Users") || ss.getActiveSheet();
    
    var userRecord = { email: email, name: "匿名医師", high_score: 0, completed_cases: [], last_played: "", status: "not_found" };
    
    if (sheet.getLastRow() > 1) {
      var data = sheet.getDataRange().getValues();
      var found = false;
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] && data[i][0].toString().toLowerCase() === email) {
          var uName = (data[i][1] || "").toString().trim();
          userRecord = {
            email: data[i][0],
            name: uName || "匿名医師",
            high_score: parseInt(data[i][2]) || 0,
            completed_cases: data[i][3] ? data[i][3].toString().split(",") : [],
            last_played: data[i][4] ? data[i][4].toString() : "",
            status: (!uName || uName === "匿名医師") ? "not_registered" : "success"
          };
          found = true;
          break;
        }
      }
      if (!found) {
        userRecord.status = "not_found";
      }
    } else {
      userRecord.status = "not_found";
    }
    
    var jsonString = JSON.stringify(userRecord);
    if (callback) {
      return ContentService.createTextOutput(callback + "(" + jsonString + ")")
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(jsonString)
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    var errObj = {status: "error", message: err.toString()};
    var callback = e.parameter.callback;
    if (callback) {
      return ContentService.createTextOutput(callback + "(" + JSON.stringify(errObj) + ")")
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(JSON.stringify(errObj))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
