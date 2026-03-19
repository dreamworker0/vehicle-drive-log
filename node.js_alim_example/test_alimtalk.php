<?php
/**
 * 알림톡 테스트 페이지
 * Cafe24에 올려서 알림톡 발송을 직접 테스트합니다.
 * 
 * 배포 위치: Cafe24 서버 (예: /alimtalk/test.php)
 */

// ── POST 요청 시 알림톡 발송 ──
$result = null;
$rawResponse = null;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $phone = $_POST['phone'] ?? '';
    $name = $_POST['name'] ?? '';
    $center = $_POST['center'] ?? '';
    $inviteCode = $_POST['invite_code'] ?? '';
    $subject = $_POST['subject'] ?? '';
    $emtitle = $_POST['emtitle'] ?? '';
    $message = $_POST['message'] ?? '';

    // CRLF → LF 개행 정리 (카카오 템플릿은 LF만 사용)
    $message = str_replace("\r\n", "\n", $message);
    $message = str_replace("\r", "\n", $message);

    // 전화번호에서 하이픈 제거
    $phone = str_replace('-', '', $phone);

    $API_URL = 'https://kakaoapi.aligo.in/akv10/alimtalk/send/';
    $API_KEY = 'ipfyzd94rd7fv6op6dfrfl89jrxo1v70';
    $USER_ID = 'jwblue';
    $SENDER_KEY = '827566940131e2f0d7e450f2d397ae9bb8ef3c6a';
    $SENDER = '010-7464-2744';
    $TPL_CODE = 'UG_2435';
    $SERVICE_LINK = 'https://vehicle-drive-log.web.app';

    // 버튼 JSON
    $button = json_encode([
        'button' => [
            [
                'name' => '차량 운행일지 서비스링크',
                'linkType' => 'WL',
                'linkM' => $SERVICE_LINK,
                'linkP' => $SERVICE_LINK,
            ]
        ]
    ]);

    $postData = [
        'apikey' => $API_KEY,
        'userid' => $USER_ID,
        'senderkey' => $SENDER_KEY,
        'tpl_code' => $TPL_CODE,
        'sender' => $SENDER,
        'receiver_1' => $phone,
        'recvname_1' => $name,
        'message_1' => $message,
        'button_1' => $button,
    ];
    if (!empty($subject)) {
        $postData['subject_1'] = $subject;
    }
    if (!empty($emtitle)) {
        $postData['emtitle_1'] = $emtitle;
    }

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $API_URL);
    curl_setopt($ch, CURLOPT_POST, 1);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
    curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($postData));
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);

    $rawResponse = curl_exec($ch);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError) {
        $result = ['success' => false, 'message' => 'curl error: ' . $curlError];
    } else {
        $result = json_decode($rawResponse, true);
    }
}
?>
<!DOCTYPE html>
<html lang="ko">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>알림톡 테스트</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
            background: #f0f2f5;
            padding: 20px;
        }

        .container {
            max-width: 700px;
            margin: 0 auto;
        }

        h1 {
            text-align: center;
            color: #1a1a2e;
            margin-bottom: 24px;
            font-size: 24px;
        }

        .card {
            background: #fff;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
            margin-bottom: 20px;
        }

        .card h2 {
            font-size: 16px;
            color: #374151;
            margin-bottom: 16px;
            border-bottom: 2px solid #3b82f6;
            padding-bottom: 8px;
        }

        label {
            display: block;
            font-size: 13px;
            color: #6b7280;
            margin-bottom: 4px;
            font-weight: 600;
        }

        input[type="text"],
        input[type="tel"] {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            font-size: 14px;
            margin-bottom: 12px;
            transition: border-color 0.2s;
        }

        input:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        textarea {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            font-size: 13px;
            font-family: monospace;
            resize: vertical;
            min-height: 200px;
            line-height: 1.6;
            margin-bottom: 12px;
        }

        textarea:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        .row {
            display: flex;
            gap: 12px;
        }

        .row>div {
            flex: 1;
        }

        button {
            width: 100%;
            padding: 12px;
            background: #3b82f6;
            color: #fff;
            border: none;
            border-radius: 8px;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
        }

        button:hover {
            background: #2563eb;
        }

        .result {
            margin-top: 16px;
            padding: 16px;
            border-radius: 8px;
            font-size: 13px;
        }

        .result.success {
            background: #ecfdf5;
            border: 1px solid #6ee7b7;
            color: #065f46;
        }

        .result.error {
            background: #fef2f2;
            border: 1px solid #fca5a5;
            color: #991b1b;
        }

        .result pre {
            white-space: pre-wrap;
            word-break: break-all;
            margin-top: 8px;
            font-size: 12px;
            background: rgba(0, 0, 0, 0.05);
            padding: 8px;
            border-radius: 4px;
        }

        .hint {
            font-size: 11px;
            color: #9ca3af;
            margin-top: -8px;
            margin-bottom: 12px;
        }

        .btn-fill {
            background: #6b7280;
            margin-top: 8px;
            font-size: 13px;
            padding: 8px;
        }

        .btn-fill:hover {
            background: #4b5563;
        }
    </style>
</head>

<body>
    <div class="container">
        <h1>🔔 알림톡 테스트 (UG_2255)</h1>

        <?php if ($result): ?>
            <div class="card">
                <div class="result <?= (isset($result['code']) && $result['code'] == 0) ? 'success' : 'error' ?>">
                    <strong><?= (isset($result['code']) && $result['code'] == 0) ? '✅ 발송 성공!' : '❌ 발송 실패' ?></strong>
                    <br>code: <?= $result['code'] ?? 'N/A' ?> / message: <?= $result['message'] ?? 'N/A' ?>
                    <?php if ($rawResponse): ?>
                        <pre><?= htmlspecialchars($rawResponse) ?></pre>
                    <?php endif; ?>
                </div>
            </div>
        <?php endif; ?>

        <form method="POST">
            <div class="card">
                <h2>📱 수신자 정보</h2>
                <div class="row">
                    <div>
                        <label>전화번호</label>
                        <input type="tel" name="phone"
                            value="<?= htmlspecialchars($_POST['phone'] ?? '010-7464-2744') ?>"
                            placeholder="010-0000-0000">
                    </div>
                    <div>
                        <label>이름 (#{name})</label>
                        <input type="text" name="name" value="<?= htmlspecialchars($_POST['name'] ?? '김종원') ?>"
                            placeholder="홍길동">
                    </div>
                </div>
                <div class="row">
                    <div>
                        <label>기관명 (#{center})</label>
                        <input type="text" name="center" value="<?= htmlspecialchars($_POST['center'] ?? '테스트기관') ?>"
                            placeholder="OO복지관">
                    </div>
                    <div>
                        <label>초대코드 (#{invite_code})</label>
                        <input type="text" name="invite_code"
                            value="<?= htmlspecialchars($_POST['invite_code'] ?? 'ABC123') ?>" placeholder="ABC123">
                    </div>
                </div>
                <div class="row">
                    <div>
                        <label>서브타이틀 (subject_1) — 비우면 미전송</label>
                        <input type="text" name="subject"
                            value="<?= htmlspecialchars($_POST['subject'] ?? '차량 운행일지') ?>" placeholder="차량 운행일지">
                    </div>
                    <div>
                        <label>타이틀 (emtitle_1) — 비우면 미전송</label>
                        <input type="text" name="emtitle"
                            value="<?= htmlspecialchars($_POST['emtitle'] ?? '기관 신청이 승인됐습니다.') ?>"
                            placeholder="기관 신청이 승인됐습니다.">
                    </div>
                </div>
            </div>

            <div class="card">
                <h2>💬 메시지 본문</h2>
                <p class="hint">카카오 알림톡은 띄어쓰기·개행까지 정확히 일치해야 합니다. 템플릿과 비교하며 수정하세요.</p>
                <textarea name="message"
                    id="messageBox"><?= htmlspecialchars($_POST['message'] ?? "안녕하세요. #{name}님!\n#{center} 신청해주셔서 감사합니다.\n\n아래 정보를 사용하여 기관관리자로 등록해주세요.\n서비스 링크 : #{service_link}\n로그인 방법 : 구글 계정으로 로그인\n초대 코드 : #{invite_code}\n\n안내사항\n- 이 초대 코드로 처음 등록하는 Google 계정이 기관관리자로 등록됩니다.\n- 초대 코드는 안전하게 보관해주세요.") ?></textarea>
                <button type="button" class="btn-fill" onclick="fillVariables()">치환 변수 적용 (미리보기)</button>
            </div>

            <button type="submit">📤 알림톡 발송 테스트</button>
        </form>
    </div>

    <script>
        function fillVariables() {
            const name = document.querySelector('[name=name]').value;
            const center = document.querySelector('[name=center]').value;
            const inviteCode = document.querySelector('[name=invite_code]').value;
            const serviceLink = 'https://vehicle-drive-log.web.app';

            let msg = document.getElementById('messageBox').value;
            msg = msg.replace(/#{name}/g, name);
            msg = msg.replace(/#{center}/g, center);
            msg = msg.replace(/#{invite_code}/g, inviteCode);
            msg = msg.replace(/#{service_link}/g, serviceLink);

            document.getElementById('messageBox').value = msg;
        }
    </script>
</body>

</html>