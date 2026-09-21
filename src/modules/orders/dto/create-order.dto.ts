import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  @Length(1, 64)
  merchantId: string;

  @IsString()
  @Length(1, 64)
  externalRef: string;

  @IsInt()
  @Min(1)
  totalCents: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;
}
