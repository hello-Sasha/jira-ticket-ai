import { IsIn, IsOptional } from 'class-validator';

const ALLOWED_TYPES = ['application/pdf', 'image/png', 'image/jpeg'] as const;

export class ReceiptUploadDto {
  @IsOptional()
  @IsIn(ALLOWED_TYPES)
  contentType?: (typeof ALLOWED_TYPES)[number];
}
