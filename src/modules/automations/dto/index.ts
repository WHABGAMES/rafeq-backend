export {
  CreateAutomationDto,
  UpdateAutomationDto,
  AutomationTriggerDto,
  AutomationActionDto,
} from './automation.dto';

// ✅ Workflow aliases (controller uses these names)
export { CreateAutomationDto as CreateWorkflowDto } from './automation.dto';
export { UpdateAutomationDto as UpdateWorkflowDto } from './automation.dto';
