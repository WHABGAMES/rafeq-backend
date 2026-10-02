import { Transform } from "class-transformer";
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class AdminLoginDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  )
  @IsOptional()
  @IsString({ message: "رمز التحقق الثنائي غير صالح" })
  @Matches(/^\d{6}$/, { message: "رمز التحقق الثنائي يجب أن يتكون من 6 أرقام" })
  totpCode?: string;
}

export class SetupAdminTwoFaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password: string;
}

export class ConfirmAdminTwoFaDto {
  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  totpCode: string;
}

export class MergeAccountsDto {
  @IsUUID() sourceUserId: string;
  @IsUUID() targetUserId: string;
  @IsIn(["MERGE"]) confirmText: "MERGE";
}

export class SuspendUserDto {
  @IsString()
  @Length(3, 500)
  reason: string;
}

export class ChangeUserEmailDto {
  @IsEmail()
  @MaxLength(255)
  newEmail: string;
}

export class HardDeleteUserDto {
  @IsIn(["HARD-DELETE"])
  confirmText: "HARD-DELETE";
}

export class SetSubscriptionPlanDto {
  @IsUUID() tenantId: string;
  @IsString() @MaxLength(30) plan: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1200) durationAmount?: number;
  @IsOptional() @IsIn(["days", "weeks", "months"]) durationUnit?:
    "days" | "weeks" | "months";
}
