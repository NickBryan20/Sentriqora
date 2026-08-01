import {
  API_KEY_SCOPES,
  ASSET_CRITICALITIES,
  ASSET_DEPENDENCY_KINDS,
  ASSET_TYPES,
  CONNECTOR_STATUSES,
  CONNECTOR_TYPES,
} from '@aegisflow/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateAssetDto {
  @ApiProperty({ enum: ASSET_CRITICALITIES })
  @IsEnum(ASSET_CRITICALITIES)
  criticality!: (typeof ASSET_CRITICALITIES)[number];

  @ApiPropertyOptional({ default: '' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: 'payments-api' })
  @Matches(/^[a-z][a-z0-9._-]{1,63}$/u)
  key!: string;

  @ApiProperty({ example: 'Payments API' })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  ownerMembershipId?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @ArrayMaxSize(20)
  @IsArray()
  @Matches(/^[a-zA-Z0-9._:-]+$/u, { each: true })
  tags?: string[];

  @ApiProperty({ enum: ASSET_TYPES })
  @IsEnum(ASSET_TYPES)
  type!: (typeof ASSET_TYPES)[number];
}

export class UpdateAssetDto {
  @ApiPropertyOptional({ enum: ASSET_CRITICALITIES })
  @IsOptional()
  @IsEnum(ASSET_CRITICALITIES)
  criticality?: (typeof ASSET_CRITICALITIES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  ownerMembershipId?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @ArrayMaxSize(20)
  @IsArray()
  @Matches(/^[a-zA-Z0-9._:-]+$/u, { each: true })
  tags?: string[];

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class CreateAssetDependencyDto {
  @ApiPropertyOptional({ default: '' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;

  @ApiProperty({ enum: ASSET_DEPENDENCY_KINDS })
  @IsEnum(ASSET_DEPENDENCY_KINDS)
  kind!: (typeof ASSET_DEPENDENCY_KINDS)[number];

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  targetAssetId!: string;
}

export class CreateConnectorDto {
  @ApiPropertyOptional({ additionalProperties: true, default: {} })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;

  @ApiPropertyOptional({ default: '' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: 'github-security' })
  @Matches(/^[a-z][a-z0-9._-]{1,63}$/u)
  key!: string;

  @ApiProperty({ example: 'GitHub Security' })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiProperty({ enum: CONNECTOR_TYPES })
  @IsEnum(CONNECTOR_TYPES)
  type!: (typeof CONNECTOR_TYPES)[number];
}

export class UpdateConnectorDto {
  @ApiPropertyOptional({ additionalProperties: true })
  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ enum: CONNECTOR_STATUSES })
  @IsOptional()
  @IsEnum(CONNECTOR_STATUSES)
  status?: (typeof CONNECTOR_STATUSES)[number];

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class RotateWebhookSecretDto {
  @ApiPropertyOptional({ default: 300, maximum: 86400, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Max(86_400)
  @Min(0)
  gracePeriodSeconds?: number;
}

export class CreateApiKeyDto {
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @IsDateString({ strict: true })
  expiresAt?: string | null;

  @ApiProperty({ example: 'SIEM production' })
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiProperty({ enum: API_KEY_SCOPES, isArray: true })
  @ArrayMaxSize(API_KEY_SCOPES.length)
  @ArrayMinSize(1)
  @IsArray()
  @IsEnum(API_KEY_SCOPES, { each: true })
  scopes!: (typeof API_KEY_SCOPES)[number][];
}

export class IdempotencyHeaderDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(/^[a-zA-Z0-9._:-]{8,128}$/u)
  value!: string;
}
