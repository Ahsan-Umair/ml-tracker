"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from "recharts";

export default function AccuracyChart({ trend }: { trend: Array<{ day: string; value: number }> }) {
  return <ResponsiveContainer width="100%" height="100%"><AreaChart data={trend} margin={{top:12,right:14,left:-22,bottom:0}}><defs><linearGradient id="accuracy" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7357f6" stopOpacity={.32}/><stop offset="100%" stopColor="#7357f6" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#dedbe8" strokeDasharray="3 6" vertical={false}/><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fontSize:10,fill:"#8a8797"}}/><Tooltip contentStyle={{border:0,borderRadius:12,boxShadow:"0 12px 30px rgba(40,30,80,.12)",fontSize:11}}/><Area type="monotone" dataKey="value" stroke="#7357f6" strokeWidth={3} fill="url(#accuracy)" dot={{r:3,fill:"#7357f6",strokeWidth:0}}/></AreaChart></ResponsiveContainer>;
}
