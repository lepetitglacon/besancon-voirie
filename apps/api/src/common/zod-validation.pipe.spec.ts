import { BadRequestException } from '@nestjs/common';
import { BboxQuery } from '@voirie/schema';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(BboxQuery);

  it('should return the parsed value', () => {
    expect(pipe.transform('5.9,47.2,6.1,47.3')).toEqual([5.9, 47.2, 6.1, 47.3]);
  });

  it('should throw a BadRequestException on invalid input', () => {
    expect(() => pipe.transform('pas-une-emprise')).toThrow(BadRequestException);
  });
});
