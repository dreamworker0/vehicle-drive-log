<?php

/* 
-----------------------------------------------------------------------------------
알림톡 전송
-----------------------------------------------------------------------------------
버튼의 경우 템플릿에 버튼이 있을때만 버튼 파라메더를 입력하셔야 합니다.
버튼이 없는 템플릿인 경우 버튼 파라메더를 제외하시기 바랍니다.
*/

$_apiURL    =	'https://kakaoapi.aligo.in/akv10/alimtalk/send/';
$_hostInfo  =	parse_url($_apiURL);
$_port      =	(strtolower($_hostInfo['scheme']) == 'https') ? 443 : 80;
$_variables =	array(
  'apikey'      => 'd4eey0t2vlw7jxnnjd1sarqk83zslcz9', 
  'userid'      => 'jaswko', 
  'senderkey'   => '	8abcd45bdd265b5e0602fc7354daa2972120c714', 
  'tpl_code'    => $_POST["tpl_code"],
  'sender'      => '010-6694-5790',
  'senddate'    => '', //date("YmdHis", strtotime("+10 minutes")),
  
  /*
  
  */
  
  /*
  'button_1'    => '{"button":[{"name":"감사 링크","linkType":"WL","linkMo" : "http://socialprism.co.kr",
    "linkPc" : "http://socialprism.co.kr"}]}', // 템플릿에 버튼이 없는경우 제거하시기 바랍니다.
  'receiver_2'  => '첫번째 알림톡을 전송받을 휴대폰 번호',
  'recvname_2'  => '첫번째 알림톡을 전송받을 사용자 명',
  'subject_2'   => '첫번째 알림톡을 제목',
  'message_2'   => '첫번째 템플릿내용을 기초로 작성된 전송할 메세지 내용',
  'button_2'    => '{"button":[{"name":"테스트 버튼","linkType":"DS"}]}' // 템플릿에 버튼이 없는경우 제거하시기 바랍니다.
  */
);

$receivers = $_POST["phone"];
$recvnames = $_POST["name"];
$isButton = $_POST["isButton"];
$receiverArray = explode(",",$receivers);
$recvnameArray = explode(",",$recvnames);
$receiverArrayLength = count($receiverArray);
print_r($receiverArrayLength);
print_r('\n');
print_r($isButton);

for($i=0; $i<$receiverArrayLength;$i++){
  $_variables["receiver_".($i+1)] = $receiverArray[$i];
  $_variables["recvname_".($i+1)] = $recvnameArray[$i];
  $_variables["subject_".($i+1)] = $_POST["subject"];
  $_variables["emtitle_".($i+1)] = $_POST["emtitle"];
  $_variables["message_".($i+1)] = str_replace('#{이름}',$recvnameArray[$i],$_POST["message"]);
  $_variables["button_".($i+1)] ='';
  if($isButton==1){
    $_variables["button_".($i+1)] = '{"button":[{"name":"대회 한눈에 보기","linkType":"WL","linkP":"https://sites.google.com/view/11thsocialworker?usp=sharing", "linkM": "https://sites.google.com/view/11thsocialworker?usp=sharing"}]}';
  }
  print_r($recvnameArray[$i]);
  print_r($_POST["message"]);
}




//print_r($_variables);

/*

-----------------------------------------------------------------
치환자 변수에 대한 처리
-----------------------------------------------------------------

등록된 템플릿이 "#{이름}님 안녕하세요?" 일경우
실제 전송할 메세지 (message_x) 에 들어갈 메세지는
"홍길동님 안녕하세요?" 입니다.

카카오톡에서는 전문과 템플릿을 비교하여 치환자이외의 부분이 일치할 경우
정상적인 메세지로 판단하여 발송처리 하는 관계로
반드시 개행문자도 템플릿과 동일하게 작성하셔야 합니다.

예제 : message_1 = "홍길동님 안녕하세요?"

-----------------------------------------------------------------
버튼타입이 WL일 경우 (웹링크)
-----------------------------------------------------------------
링크정보는 다음과 같으며 버튼도 치환변수를 사용할 수 있습니다.
{"button":[{"name":"버튼명","linkType":"WL","linkP":"https://www.링크주소.com/?example=12345", "linkM": "https://www.링크주소.com/?example=12345"}]}

-----------------------------------------------------------------
버튼타입이 AL 일 경우 (앱링크)
-----------------------------------------------------------------
{"button":[{"name":"버튼명","linkType":"AL","linkI":"https://www.링크주소.com/?example=12345", "linkA": "https://www.링크주소.com/?example=12345"}]}

-----------------------------------------------------------------
버튼타입이 DS 일 경우 (배송조회)
-----------------------------------------------------------------
{"button":[{"name":"버튼명","linkType":"DS"}]}

-----------------------------------------------------------------
버튼타입이 BK 일 경우 (봇키워드)
-----------------------------------------------------------------
{"button":[{"name":"버튼명","linkType":"BK"}]}

-----------------------------------------------------------------
버튼타입이 MD 일 경우 (메세지 전달)
-----------------------------------------------------------------
{"button":[{"name":"버튼명","linkType":"MD"}]}

-----------------------------------------------------------------
버튼이 여러개 인경우 (WL + DS)
-----------------------------------------------------------------
{"button":[{"name":"버튼명","linkType":"WL","linkP":"https://www.링크주소.com/?example=12345", "linkM": "https://www.링크주소.com/?example=12345"}, {"name":"버튼명","linkType":"DS"}]}

*/


$oCurl = curl_init();
curl_setopt($oCurl, CURLOPT_PORT, $_port);
curl_setopt($oCurl, CURLOPT_URL, $_apiURL);
curl_setopt($oCurl, CURLOPT_POST, 1);
curl_setopt($oCurl, CURLOPT_RETURNTRANSFER, 1);
curl_setopt($oCurl, CURLOPT_POSTFIELDS, http_build_query($_variables));
curl_setopt($oCurl, CURLOPT_SSL_VERIFYPEER, FALSE);

$ret = curl_exec($oCurl);
$error_msg = curl_error($oCurl);
curl_close($oCurl);

// 리턴 JSON 문자열 확인
print_r($ret . PHP_EOL);

// JSON 문자열 배열 변환
$retArr = json_decode($ret);

// 결과값 출력
print_r($retArr);

/*
code : 0 성공, 나머지 숫자는 에러
message : 결과 메시지
*/