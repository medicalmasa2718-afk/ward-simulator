function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);
    var action = params.action;
    
    if (action === "stats") {
      // 症例スタッツの保存
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
    
    // 既存のプレイヤースコア保存ロジック
    var email = (params.email || "").toLowerCase().trim();
    if (!email) throw new Error("Email required");
    
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
    
    if (foundRow !== -1) {
      sheet.getRange(foundRow, 2).setValue(name);
      sheet.getRange(foundRow, 3).setValue(highScore);
      sheet.getRange(foundRow, 4).setValue(completedCasesStr);
      sheet.getRange(foundRow, 5).setValue(lastPlayed);
    } else {
      sheet.appendRow([email, name, highScore, completedCasesStr, lastPlayed]);
    }
    
    return ContentService.createTextOutput(JSON.stringify({status: "success"}))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({status: "error", message: err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    var action = e.parameter.action;
    
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
      return ContentService.createTextOutput(JSON.stringify(stats))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 既存のプレイヤー取得ロジック
    var email = e.parameter.email;
    if (!email) throw new Error("Email required");
    email = email.toLowerCase().trim();
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Users") || ss.getActiveSheet();
    
    var userRecord = { email: email, name: "匿名医師", high_score: 0, completed_cases: [], last_played: "" };
    
    if (sheet.getLastRow() > 1) {
      var data = sheet.getDataRange().getValues();
      var found = false;
      for (var i = 1; i < data.length; i++) {
        if (data[i][0] && data[i][0].toString().toLowerCase() === email) {
          userRecord = {
            email: data[i][0],
            name: data[i][1],
            high_score: parseInt(data[i][2]) || 0,
            completed_cases: data[i][3] ? data[i][3].toString().split(",") : [],
            last_played: data[i][4] ? data[i][4].toString() : ""
          };
          found = true;
          break;
        }
      }
      userRecord.status = found ? "success" : "not_found";
    } else {
      userRecord.status = "not_found";
    }
    
    return ContentService.createTextOutput(JSON.stringify(userRecord))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({status: "error", message: err.toString()}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
