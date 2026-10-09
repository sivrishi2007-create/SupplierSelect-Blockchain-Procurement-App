import { Router, type IRouter } from "express";
import healthRouter from "./health";
import procurementRouter from "./procurement";

const router: IRouter = Router();

router.use(healthRouter);
router.use(procurementRouter);

export default router;
