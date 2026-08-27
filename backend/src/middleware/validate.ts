import { Response, NextFunction } from 'express';
import { z } from 'zod';

/**
 * Zod validation middleware factory.
 * Validates req.body against the provided Zod schema.
 */
export function validate(schema: z.ZodType<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join('.');
        if (!errors[path]) errors[path] = [];
        errors[path].push(issue.message);
      }
      res.status(400).json({
        success: false,
        error: {
          message: 'Validation failed.',
          statusCode: 400,
        },
        errors,
      });
      return;
    }
    // Replace req.body with parsed (and possibly transformed) data
    Object.assign(req, { body: result.data });
    next();
  };
}
