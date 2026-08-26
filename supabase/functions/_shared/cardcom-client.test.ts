import { afterEach, describe, expect, it, vi } from "vitest";
import { createCardcomClient } from "./cardcom-client";

const CREDENTIALS = { terminalNumber: "1000", userName: "test-user" };

const BASE_REQUEST = {
  amountAgorot: 98_000,
  productName: "דוח אפס - בדיקת כדאיות כלכלית",
  returnValue: "po_abc123",
  successRedirectUrl: "https://haimetkin-lgtm.github.io/dohefes/cashflow/",
  errorRedirectUrl: "https://haimetkin-lgtm.github.io/dohefes/cashflow/",
  indicatorUrl: "https://project-ref.supabase.co/functions/v1/cardcom-payment-indicator",
};

function nameToValueResponse(fields: Record<string, string>): Response {
  const body = new URLSearchParams(fields).toString();
  return new Response(body, { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createCardcomClient().createLowProfile - בקשה יוצאת", () => {
  it("שולחת POST form-urlencoded עם SumToBill=980.00 (98_000 אגורות), בלי AutoRedirect", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return nameToValueResponse({ ResponseCode: "0", LowProfileCode: "lpc-1", url: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" });
      })
    );

    const client = createCardcomClient(CREDENTIALS);
    await client.createLowProfile(BASE_REQUEST);

    expect(capturedUrl).toBe("https://secure.cardcom.solutions/Interface/LowProfile.aspx");
    expect(capturedInit?.method).toBe("POST");
    expect((capturedInit?.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const sentParams = new URLSearchParams(capturedInit?.body as string);
    expect(sentParams.get("SumToBill")).toBe("980.00");
    expect(sentParams.get("Operation")).toBe("1");
    expect(sentParams.get("TerminalNumber")).toBe("1000");
    expect(sentParams.get("UserName")).toBe("test-user");
    expect(sentParams.get("CoinId")).toBe("1");
    expect(sentParams.get("APILevel")).toBe("10");
    expect(sentParams.get("Codepage")).toBe("65001");
    expect(sentParams.get("ReturnValue")).toBe("po_abc123");
    expect(sentParams.has("AutoRedirect")).toBe(false);
    // אין סיסמה בבקשה בכלל - ר' cardcom-client.ts §4
    expect(sentParams.has("ApiPassword")).toBe(false);
    expect(sentParams.has("Password")).toBe(false);
  });

  it("חותכת ProductName ל-50 תווים", async () => {
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedInit = init;
        return nameToValueResponse({ ResponseCode: "0", LowProfileCode: "lpc-1", url: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" });
      })
    );

    const client = createCardcomClient(CREDENTIALS);
    await client.createLowProfile({ ...BASE_REQUEST, productName: "א".repeat(80) });

    const sentParams = new URLSearchParams(capturedInit?.body as string);
    expect(sentParams.get("ProductName")?.length).toBe(50);
  });
});

describe("createCardcomClient().createLowProfile - פענוח תגובה", () => {
  it("ResponseCode=0 + LowProfileCode + url תקין -> הצלחה", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        nameToValueResponse({ ResponseCode: "0", LowProfileCode: "lpc-42", url: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" })
      )
    );

    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.createLowProfile(BASE_REQUEST);

    expect(outcome).toEqual({
      ok: true,
      result: { lowProfileCode: "lpc-42", checkoutUrl: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" },
    });
  });

  it("ResponseCode!=0 -> failed (provider_rejected), לא נחשף Description", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => nameToValueResponse({ ResponseCode: "1", Description: "פרטי כרטיס לא תקינים - מספר לקוח 12345" }))
    );

    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.createLowProfile(BASE_REQUEST);

    expect(outcome.ok).toBe(false);
    expect(outcome).toEqual({ ok: false, failureCode: "provider_rejected" });
    // ודאות נוספת: אין שום מקום ב-outcome שמכיל את מחרוזת ה-Description
    expect(JSON.stringify(outcome)).not.toContain("12345");
    expect(JSON.stringify(outcome)).not.toContain("Description");
  });

  it("חסר LowProfileCode -> failed (provider_missing_fields)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nameToValueResponse({ ResponseCode: "0", url: "https://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" })));
    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.createLowProfile(BASE_REQUEST);
    expect(outcome).toEqual({ ok: false, failureCode: "provider_missing_fields" });
  });

  it("חסר url -> failed (provider_missing_fields)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nameToValueResponse({ ResponseCode: "0", LowProfileCode: "lpc-1" })));
    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.createLowProfile(BASE_REQUEST);
    expect(outcome).toEqual({ ok: false, failureCode: "provider_missing_fields" });
  });

  it("checkout url לא-https -> failed (provider_untrusted_checkout_url)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nameToValueResponse({ ResponseCode: "0", LowProfileCode: "lpc-1", url: "http://secure.cardcom.solutions/EA/EA5/xyz/PaymentSP" })));
    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.createLowProfile(BASE_REQUEST);
    expect(outcome).toEqual({ ok: false, failureCode: "provider_untrusted_checkout_url" });
  });

  it("checkout url על host שאינו Cardcom -> failed (provider_untrusted_checkout_url)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nameToValueResponse({ ResponseCode: "0", LowProfileCode: "lpc-1", url: "https://evil.example/phishing" })));
    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.createLowProfile(BASE_REQUEST);
    expect(outcome).toEqual({ ok: false, failureCode: "provider_untrusted_checkout_url" });
  });

  it("שגיאת רשת (fetch נכשל) -> failed (provider_unreachable), לא זורקת", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.createLowProfile(BASE_REQUEST);
    expect(outcome).toEqual({ ok: false, failureCode: "provider_unreachable" });
  });

  it("HTTP לא-2xx -> failed (provider_http_<status>)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.createLowProfile(BASE_REQUEST);
    expect(outcome).toEqual({ ok: false, failureCode: "provider_http_500" });
  });
});

describe("createCardcomClient().createLowProfile - ולידציית config", () => {
  it("callback URL שאינו https (secret מוגדר שגוי) -> failed לפני שיוצאת בקשת רשת", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.createLowProfile({ ...BASE_REQUEST, indicatorUrl: "http://not-https.example" });

    expect(outcome).toEqual({ ok: false, failureCode: "invalid_callback_url_config" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("סכום לא-תקין (0/שלילי/float) -> failed (invalid_amount), לפני יציאת בקשה", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.createLowProfile({ ...BASE_REQUEST, amountAgorot: 0 });

    expect(outcome).toEqual({ ok: false, failureCode: "invalid_amount" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

function indicatorSuccessFields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    Operation: "1",
    OperationResponse: "0",
    DealResponse: "0",
    InternalDealNumber: "deal-1",
    TerminalNumber: CREDENTIALS.terminalNumber,
    LowProfileCode: "lpc-1",
    ReturnValue: "po_abc123",
    CoinId: "1",
    "ExtShvaParams.Sum36": "98000",
    ...overrides,
  };
}

describe("createCardcomClient().getLowProfileIndicator - בקשה יוצאת", () => {
  it("שולחת GET עם TerminalNumber/UserName/LowProfileCode/codepage ב-query string", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return nameToValueResponse(indicatorSuccessFields());
      })
    );

    const client = createCardcomClient(CREDENTIALS);
    await client.getLowProfileIndicator({ lowProfileCode: "lpc-1" });

    expect(capturedInit?.method).toBe("GET");
    const url = new URL(capturedUrl!);
    expect(url.origin + url.pathname).toBe("https://secure.cardcom.solutions/Interface/BillGoldGetLowProfileIndicator.aspx");
    expect(url.searchParams.get("TerminalNumber")).toBe("1000");
    expect(url.searchParams.get("UserName")).toBe("test-user");
    expect(url.searchParams.get("LowProfileCode")).toBe("lpc-1");
    expect(url.searchParams.get("codepage")).toBe("65001");
  });
});

describe("createCardcomClient().getLowProfileIndicator - פענוח תגובה", () => {
  it("כל התנאים מתקיימים -> ok:true עם השדות המאומתים (לא ה-payload הגולמי)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nameToValueResponse(indicatorSuccessFields())));
    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.getLowProfileIndicator({ lowProfileCode: "lpc-1" });

    expect(outcome).toEqual({
      ok: true,
      fields: { internalDealNumber: "deal-1", returnValue: "po_abc123", coinId: 1, amountAgorot: 98000 },
    });
  });

  it("98,000 אגורות תואם ל-ExtShvaParams.Sum36=98000 (בלי המרה נוספת - שלא כמו SumToBill)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nameToValueResponse(indicatorSuccessFields({ "ExtShvaParams.Sum36": "98000" }))));
    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.getLowProfileIndicator({ lowProfileCode: "lpc-1" });
    expect(outcome.ok).toBe(true);
    expect(outcome.ok && outcome.fields.amountAgorot).toBe(98000);
  });

  it("פענוח לא תלוי-רישיות של מפתחות התגובה", async () => {
    const lowercased = Object.fromEntries(Object.entries(indicatorSuccessFields()).map(([k, v]) => [k.toLowerCase(), v]));
    vi.stubGlobal("fetch", vi.fn(async () => nameToValueResponse(lowercased)));
    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.getLowProfileIndicator({ lowProfileCode: "lpc-1" });
    expect(outcome).toEqual({
      ok: true,
      fields: { internalDealNumber: "deal-1", returnValue: "po_abc123", coinId: 1, amountAgorot: 98000 },
    });
  });

  it("Operation!=1 -> failed (operation_failed)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nameToValueResponse(indicatorSuccessFields({ Operation: "0" }))));
    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.getLowProfileIndicator({ lowProfileCode: "lpc-1" });
    expect(outcome).toEqual({ ok: false, failureCode: "operation_failed" });
  });

  it("OperationResponse!=0 -> failed (operation_failed)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nameToValueResponse(indicatorSuccessFields({ OperationResponse: "1" }))));
    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.getLowProfileIndicator({ lowProfileCode: "lpc-1" });
    expect(outcome).toEqual({ ok: false, failureCode: "operation_failed" });
  });

  it("DealResponse!=0 -> failed (operation_failed)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nameToValueResponse(indicatorSuccessFields({ DealResponse: "1" }))));
    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.getLowProfileIndicator({ lowProfileCode: "lpc-1" });
    expect(outcome).toEqual({ ok: false, failureCode: "operation_failed" });
  });

  it("InternalDealNumber חסר -> failed (operation_failed)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nameToValueResponse(indicatorSuccessFields({ InternalDealNumber: "" }))));
    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.getLowProfileIndicator({ lowProfileCode: "lpc-1" });
    expect(outcome).toEqual({ ok: false, failureCode: "operation_failed" });
  });

  it("TerminalNumber בתגובה לא תואם לסוד שלנו -> failed (operation_failed)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nameToValueResponse(indicatorSuccessFields({ TerminalNumber: "9999" }))));
    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.getLowProfileIndicator({ lowProfileCode: "lpc-1" });
    expect(outcome).toEqual({ ok: false, failureCode: "operation_failed" });
  });

  it("LowProfileCode בתגובה לא תואם למה שביקשנו -> failed (operation_failed)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nameToValueResponse(indicatorSuccessFields({ LowProfileCode: "lpc-DIFFERENT" }))));
    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.getLowProfileIndicator({ lowProfileCode: "lpc-1" });
    expect(outcome).toEqual({ ok: false, failureCode: "operation_failed" });
  });

  it("שדות מכריעים (Operation/OperationResponse/DealResponse) חסרים לגמרי -> failed (not_completed), retryable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => nameToValueResponse({})));
    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.getLowProfileIndicator({ lowProfileCode: "lpc-1" });
    expect(outcome).toEqual({ ok: false, failureCode: "not_completed" });
  });

  it("שגיאת רשת -> failed (provider_unreachable), לא זורקת", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.getLowProfileIndicator({ lowProfileCode: "lpc-1" });
    expect(outcome).toEqual({ ok: false, failureCode: "provider_unreachable" });
  });

  it("HTTP לא-2xx -> failed (provider_http_<status>)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    const client = createCardcomClient(CREDENTIALS);
    const outcome = await client.getLowProfileIndicator({ lowProfileCode: "lpc-1" });
    expect(outcome).toEqual({ ok: false, failureCode: "provider_http_500" });
  });
});
