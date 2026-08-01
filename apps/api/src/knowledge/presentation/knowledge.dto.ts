import {
  KNOWLEDGE_CONTENT_TYPES,
  KNOWLEDGE_SOURCE_TYPES,
  KNOWLEDGE_TRUST_LEVELS,
  MAX_KNOWLEDGE_DOCUMENT_BYTES,
} from '@aegisflow/contracts';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, IsUrl, Length, MaxLength } from 'class-validator';

export class CreateKnowledgeDocumentDto {
  @ApiProperty({ maxLength: MAX_KNOWLEDGE_DOCUMENT_BYTES })
  @IsString()
  @Length(40, MAX_KNOWLEDGE_DOCUMENT_BYTES)
  content!: string;

  @ApiProperty({ enum: KNOWLEDGE_CONTENT_TYPES })
  @IsEnum(KNOWLEDGE_CONTENT_TYPES)
  contentType!: (typeof KNOWLEDGE_CONTENT_TYPES)[number];

  @ApiProperty({ enum: KNOWLEDGE_SOURCE_TYPES })
  @IsEnum(KNOWLEDGE_SOURCE_TYPES)
  sourceType!: (typeof KNOWLEDGE_SOURCE_TYPES)[number];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  sourceUri?: string | null;

  @ApiProperty() @IsString() @Length(3, 180) title!: string;

  @ApiProperty({ enum: KNOWLEDGE_TRUST_LEVELS })
  @IsEnum(KNOWLEDGE_TRUST_LEVELS)
  trustLevel!: (typeof KNOWLEDGE_TRUST_LEVELS)[number];
}

export class CreateKnowledgeVersionDto {
  @ApiProperty({ maxLength: MAX_KNOWLEDGE_DOCUMENT_BYTES })
  @IsString()
  @Length(40, MAX_KNOWLEDGE_DOCUMENT_BYTES)
  content!: string;
}

export class RequestRecommendationDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  incidentId?: string | null;

  @ApiProperty() @IsString() @Length(8, 2_000) question!: string;
}
