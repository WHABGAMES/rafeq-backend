import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { AdminLoginDto } from "./admin-security.dto";

const validCredentials = {
  email: "admin@example.com",
  password: "a-secure-test-password",
};

describe("AdminLoginDto", () => {
  it.each([
    ["an omitted TOTP code", undefined],
    ["an empty TOTP code sent by an older client", ""],
    ["a whitespace-only TOTP code sent by an older client", "   "],
  ])(
    "accepts %s during the first login step",
    async (_description, totpCode) => {
      const dto = plainToInstance(AdminLoginDto, {
        ...validCredentials,
        totpCode,
      });

      await expect(validate(dto)).resolves.toHaveLength(0);
      expect(dto.totpCode).toBeUndefined();
    },
  );

  it("accepts a six-digit TOTP code during the second login step", async () => {
    const dto = plainToInstance(AdminLoginDto, {
      ...validCredentials,
      totpCode: "123456",
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.totpCode).toBe("123456");
  });

  it.each(["12345", "1234567", "12345a"])(
    "rejects an invalid TOTP code: %s",
    async (totpCode) => {
      const dto = plainToInstance(AdminLoginDto, {
        ...validCredentials,
        totpCode,
      });
      const errors = await validate(dto);

      expect(errors).toHaveLength(1);
      expect(errors[0].constraints).toEqual(
        expect.objectContaining({
          matches: "رمز التحقق الثنائي يجب أن يتكون من 6 أرقام",
        }),
      );
    },
  );
});
