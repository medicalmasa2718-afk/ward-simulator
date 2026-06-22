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
    
    // 統計情報保存
    if (action === "stats") {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
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
    
    // --- プレイヤーのユーザー登録・スコア保存 ---
    var name = (params.name || "").toString().trim();
    if (!name) throw new Error("Name required");
    
    var highScore = parseInt(params.high_score) || 0;
    var completedCasesStr = "";
    if (params.completed_cases) {
      completedCasesStr = Array.isArray(params.completed_cases) ? params.completed_cases.join(",") : params.completed_cases.toString();
    }
    var lastPlayed = params.last_played || new Date().toLocaleString("ja-JP", {timeZone: "Asia/Tokyo"});
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Users");
    if (!sheet) {
      sheet = ss.insertSheet("Users");
      sheet.appendRow(["Email", "Name", "High Score", "Completed Cases", "Last Played"]);
      sheet.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#f3f3f3");
    }
    
    var data = sheet.getDataRange().getValues();
    var foundRow = -1;
    // Name列（2列目、インデックス1）で検索する
    for (var i = 1; i < data.length; i++) {
      if (data[i][1] && data[i][1].toString().trim() === name) {
        foundRow = i + 1;
        break;
      }
    }
    
    if (foundRow !== -1) {
      // 既存ユーザーのスコアを更新
      sheet.getRange(foundRow, 3).setValue(highScore);
      sheet.getRange(foundRow, 4).setValue(completedCasesStr);
      sheet.getRange(foundRow, 5).setValue(lastPlayed);
    } else {
      // 新規登録。Email列にはダミー（またはname+"@internal"）を入れておく
      var dummyEmail = name + "@internal";
      sheet.appendRow([dummyEmail, name, highScore, completedCasesStr, lastPlayed]);
    }
    
    return ContentService.createTextOutput(JSON.stringify({status: "success", name: name, high_score: highScore}))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({status: "error", message: err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    var action = e.parameter.action;
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
    
    // --- ユーザー情報の照会・ログイン ---
    if (action === "login") {
      var name = (e.parameter.name || "").toString().trim();
      if (!name) throw new Error("Name parameter required");
      
      var sheet = ss.getSheetByName("Users");
      var userRecord = { name: name, high_score: 0, completed_cases: [], last_played: "", status: "not_found" };
      
      if (sheet && sheet.getLastRow() > 1) {
        var data = sheet.getDataRange().getValues();
        for (var i = 1; i < data.length; i++) {
          if (data[i][1] && data[i][1].toString().trim() === name) {
            userRecord = {
              name: data[i][1].toString().trim(),
              high_score: parseInt(data[i][2]) || 0,
              completed_cases: data[i][3] ? data[i][3].toString().split(",") : [],
              last_played: data[i][4] ? data[i][4].toString() : "",
              status: "success"
            };
            break;
          }
        }
      }
      
      return ContentService.createTextOutput(JSON.stringify(userRecord))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    throw new Error("Invalid action parameter");
    
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({status: "error", message: err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
