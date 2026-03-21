<?php
/**
 * 알림톡 발송 프록시 API (v2 — 패스스루 방식)
 * Cloud Functions에서 구성한 메시지를 그대로 알리고 API로 전달합니다.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: https://vehicle-drive-log.web.app');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type, X-API-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method Not Allowed']);
    exit();
}

// ── 설정 파일 로드 (웹 루트 밖) ──
$config = require __DIR__ . '/../../aligo_config.php';

// ── 인증 토큰 검증 ──
$AUTH_TOKEN = $config['auth_token'];
$headers = getallheaders();
$token = $headers['X-API-Token'] ?? $headers['x-api-token'] ?? '';
if ($token !== $AUTH_TOKEN) {
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => 'Unauthorized']);
    exit();
}

// ── 요청 파라미터 파싱 ──
$input = json_decode(file_get_contents('php://input'), true);
if (!$input) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Invalid JSON body']);
    exit();
}

// Cloud Functions에서 구성한 알리고 API 파라미터를 그대로 사용
$postData = $input['aligo_params'] ?? null;
if (!$postData) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Missing aligo_params']);
    exit();
}

// ── 알리고 API 고정 인증 정보 추가 ──
$postData['apikey']     = $config['apikey'];
$postData['userid']     = $config['userid'];
$postData['senderkey']  = $config['senderkey'];
$postData['sender']     = $config['sender'];
// tpl_code는 Cloud Functions(sendAlimtalk.ts)에서 관리

// ── 알리고 API 호출 ──
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'https://kakaoapi.aligo.in/akv10/alimtalk/send/');
curl_setopt($ch, CURLOPT_POST, 1);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($postData));
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

$response = curl_exec($ch);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'curl error: ' . $curlError]);
    exit();
}

$result = json_decode($response, true);
echo json_encode([
    'success' => ($result && isset($result['code']) && $result['code'] == 0),
    'code' => $result['code'] ?? -1,
    'message' => $result['message'] ?? 'Unknown error',
    'info' => $result['info'] ?? null,
    'raw' => $response,
]);
