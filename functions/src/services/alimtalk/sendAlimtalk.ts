/**
 * sendAlimtalk — Cafe24 PHP 프록시를 통한 카카오 알림톡 발송 헬퍼
 *
 * Cloud Functions에서 메시지를 구성하고, PHP 프록시는 알리고 API로 패스스루합니다.
 * Node.js의 \n은 확실히 LF(0x0A)이므로 CRLF 문제가 발생하지 않습니다.
 */

interface AlimtalkResult {
    success: boolean;
    code?: number;
    message?: string;
}

const SERVICE_URL = "https://vehicle-drive-log.web.app";

/**
 * 승인 알림톡 발송 (Cafe24 프록시 경유)
 */
export async function sendApprovalAlimtalk(
    phone: string,
    name: string,
    centerName: string,
    inviteCode: string
): Promise<AlimtalkResult> {
    const proxyUrl = process.env.ALIMTALK_PROXY_URL;
    const proxyToken = process.env.ALIMTALK_PROXY_TOKEN;

    if (!proxyUrl || !proxyToken) {
        console.error("[Alimtalk] ❌ 프록시 환경변수가 설정되지 않았습니다.");
        return { success: false, message: "프록시 환경변수 미설정" };
    }

    // 전화번호 하이픈 제거
    const cleanPhone = phone.replace(/-/g, "");

    // 서비스 링크 (초대코드 포함)
    const serviceLink = `${SERVICE_URL}?code=${inviteCode}`;

    // 메시지 본문 구성 (Node.js \n = 확실한 LF)
    const message = [
        `안녕하세요. ${name}님!`,
        `${centerName}에서 신청해주셔서 감사합니다.`,
        "",
        "아래 정보를 사용하여 기관관리자로 등록해주세요.",
        `서비스 링크 : ${serviceLink}`,
        "로그인 방법 : 구글 계정으로 로그인",
        `초대 코드 : ${inviteCode}`,
        "",
        "안내사항",
        "- 이 초대 코드로 처음 등록하는 Google 계정이 기관관리자로 등록됩니다.",
        "- 초대 코드는 안전하게 보관해주세요.",
    ].join("\n");

    // 버튼 JSON (템플릿에 등록된 고정 URL 사용 — 쿼리 파라미터 붙이면 템플릿 불일치 오류)
    const button = JSON.stringify({
        button: [{
            name: "차량 운행일지 서비스링크",
            linkType: "WL",
            linkM: SERVICE_URL,
            linkP: SERVICE_URL,
        }],
    });

    // 알리고 API 파라미터 (PHP에서 인증 정보 추가)
    const aligoParams: Record<string, string> = {
        tpl_code: "UG_2592",
        receiver_1: cleanPhone,
        recvname_1: name,
        subject_1: "차량 운행일지",
        emtitle_1: "기관 신청이 승인됐습니다.",
        message_1: message,
        button_1: button,
    };

    try {
        const response = await fetch(proxyUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Token": proxyToken,
            },
            body: JSON.stringify({ aligo_params: aligoParams }),
        });

        const result = await response.json() as Record<string, unknown>;
        console.log(`[Alimtalk] 프록시 응답: ${JSON.stringify(result)}`);

        if (result.success) {
            console.log(`[Alimtalk] ✅ 알림톡 발송 성공: ${phone} (${name})`);
        } else {
            console.error(`[Alimtalk] ❌ 알림톡 발송 실패: code=${result.code}, message=${result.message}`);
        }

        return result as unknown as AlimtalkResult;
    } catch (err: unknown) {
        console.error("[Alimtalk] ❌ 프록시 호출 중 예외:", (err as Error).message);
        return { success: false, message: (err as Error).message };
    }
}

/**
 * 미활성 기관 리마인드 알림톡 발송 (템플릿 UG_2597)
 */
export async function sendReminderAlimtalk(
    phone: string,
    name: string,
    centerName: string,
    inviteCode: string
): Promise<AlimtalkResult> {
    const proxyUrl = process.env.ALIMTALK_PROXY_URL;
    const proxyToken = process.env.ALIMTALK_PROXY_TOKEN;

    if (!proxyUrl || !proxyToken) {
        console.error("[Alimtalk] ❌ 프록시 환경변수가 설정되지 않았습니다.");
        return { success: false, message: "프록시 환경변수 미설정" };
    }

    const cleanPhone = phone.replace(/-/g, "");
    const serviceLink = `${SERVICE_URL}?code=${inviteCode}`;

    const message = [
        `안녕하세요. ${name}님!`,
        `${centerName}의 관리자로 등록해주세요.`,
        "",
        "승인된 기관이지만 아직 관리자 등록이 완료되지 않았습니다.",
        "아래 정보를 사용하여 등록을 완료해주세요.",
        "",
        `서비스 링크 : ${serviceLink}`,
        "로그인 방법 : 구글 계정으로 로그인",
        `초대 코드 : ${inviteCode}`,
        "",
        "문의사항이 있으시면 언제든 연락주세요.",
    ].join("\n");

    const button = JSON.stringify({
        button: [{
            name: "차량 운행일지 서비스링크",
            linkType: "WL",
            linkM: SERVICE_URL,
            linkP: SERVICE_URL,
        }],
    });

    const aligoParams: Record<string, string> = {
        tpl_code: "UG_2597",
        receiver_1: cleanPhone,
        recvname_1: name,
        subject_1: "차량 운행일지",
        emtitle_1: "기관 관리자 등록해주세요.",
        message_1: message,
        button_1: button,
    };

    try {
        const response = await fetch(proxyUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Token": proxyToken,
            },
            body: JSON.stringify({ aligo_params: aligoParams }),
        });

        const result = await response.json() as Record<string, unknown>;
        console.log(`[Alimtalk] 리마인드 프록시 응답: ${JSON.stringify(result)}`);

        if (result.success) {
            console.log(`[Alimtalk] ✅ 리마인드 발송 성공: ${phone} (${name})`);
        } else {
            console.error(`[Alimtalk] ❌ 리마인드 발송 실패: code=${result.code}, message=${result.message}`);
        }

        return result as unknown as AlimtalkResult;
    } catch (err: unknown) {
        console.error("[Alimtalk] ❌ 리마인드 프록시 호출 중 예외:", (err as Error).message);
        return { success: false, message: (err as Error).message };
    }
}
